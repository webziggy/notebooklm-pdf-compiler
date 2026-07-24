const http = require('http');

function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 11434,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(body);
                    }
                } else {
                    reject(new Error(`Ollama API error: ${res.statusCode} - ${body}`));
                }
            });
        });

        req.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                reject(new Error("Ollama is not running. Please ensure Ollama is installed (https://ollama.com) and running locally."));
            } else {
                reject(err);
            }
        });

        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function checkOllama() {
    try {
        const res = await makeRequest('GET', '/api/tags');
        return res.models || [];
    } catch (err) {
        throw err;
    }
}

async function ensureModel(modelName, onProgress) {
    const models = await checkOllama();
    const hasModel = models.some(m => m.name === modelName || m.name.startsWith(modelName + ':'));
    
    if (!hasModel) {
        if (onProgress) onProgress(`Downloading ${modelName}... This may take a moment.`);
        // Note: The simple HTTP wrapper above buffers the whole response.
        // For a pull, it might be better to just let it buffer, but it can take a while.
        // We set stream: false so it just waits and returns success when done.
        await makeRequest('POST', '/api/pull', { name: modelName, stream: false });
        if (onProgress) onProgress(`Finished downloading ${modelName}.`);
    }
}

async function getEmbeddings(texts, modelName) {
    const embeddings = [];
    for (const text of texts) {
        try {
            const res = await makeRequest('POST', '/api/embeddings', {
                model: modelName,
                prompt: text
            });
            embeddings.push(res.embedding);
        } catch (err) {
            throw new Error(`Failed to generate embedding for ${text}: ${err.message}`);
        }
    }
    return embeddings;
}

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// LCS Fallback Naming
function getUniqueName(baseName, existingNames) {
    let name = baseName;
    let counter = 2;
    while (existingNames.has(name)) {
        name = `${baseName}_${counter}`;
        counter++;
    }
    existingNames.add(name);
    return name;
}

function nameClusterLCS(files, existingNames) {
    const bases = files.map(f => f.replace(/\.pdf$/i, ''));
    if (bases.length === 1) return getUniqueName(bases[0], existingNames);

    const first = bases[0];
    let maxStr = "";
    for (let i = 0; i < first.length; i++) {
        for (let j = i + 1; j <= first.length; j++) {
            const sub = first.substring(i, j);
            if (sub.length > maxStr.length && bases.every(s => s.includes(sub))) {
                maxStr = sub;
            }
        }
    }

    let cleanName = maxStr.replace(/[^a-zA-Z0-9 -_]/g, '').trim();
    cleanName = cleanName.replace(/^[-_]+|[-_]+$/g, ''); 
    if (cleanName.length < 3) cleanName = "Cluster";
    
    return getUniqueName(cleanName, existingNames);
}

async function nameClustersWithLLM(groupedFilesMap, textModel) {
    // Convert map to array of lists
    const clusters = Object.values(groupedFilesMap);
    
    const prompt = `
You are an expert file organizer. Given a list of filenames belonging to a single group, reply with a SHORT, professional folder name that best represents them.
RULES:
1. Output ONLY the folder name, nothing else. No quotes, no markdown, no explanation.
2. The name should be 1-3 words.
3. Use CamelCase or Spaces.

Filenames:
__FILES__
    `.trim();

    const namedGroups = {};
    const existingNames = new Set(["Ungrouped", "Holding Area"]);

    for (const files of clusters) {
        if (files.length === 0) continue;
        
        const filesListStr = files.join("\n");
        const clusterPrompt = prompt.replace("__FILES__", filesListStr);
        
        try {
            const res = await makeRequest('POST', '/api/generate', {
                model: textModel,
                prompt: clusterPrompt,
                stream: false,
                options: { temperature: 0.2 }
            });
            
            let suggestedName = (res.response || "").trim();
            // Clean up LLM output (remove quotes, weird chars)
            suggestedName = suggestedName.replace(/["']/g, '').replace(/[^a-zA-Z0-9 -_]/g, '').trim();
            if (suggestedName.length < 2) suggestedName = "Cluster";
            
            const finalName = getUniqueName(suggestedName, existingNames);
            namedGroups[finalName] = files;
        } catch (err) {
            // Fallback to LCS on failure
            const finalName = nameClusterLCS(files, existingNames);
            namedGroups[finalName] = files;
        }
    }
    
    return namedGroups;
}

async function performAIGrouping(files, similarityTarget = 0.5, onProgress) {
    const EMBED_MODEL = 'nomic-embed-text';
    const TEXT_MODEL = 'llama3';
    
    if (onProgress) onProgress("Checking Ollama connection...");
    const models = await checkOllama();
    
    await ensureModel(EMBED_MODEL, onProgress);
    
    if (onProgress) onProgress("Generating semantic embeddings for files...");
    const embeddings = await getEmbeddings(files, EMBED_MODEL);
    
    if (onProgress) onProgress("Calculating semantic distances...");
    const hclust = require('ml-hclust');
    const distanceMatrix = [];
    
    for (let i = 0; i < files.length; i++) {
        const row = [];
        for (let j = 0; j < files.length; j++) {
            if (i === j) row.push(0);
            else if (j < i) row.push(distanceMatrix[j][i]);
            else {
                const sim = cosineSimilarity(embeddings[i], embeddings[j]);
                // Ensure distance is strictly between 0 and 1, avoiding floating point math errors
                row.push(Math.max(0, Math.min(1, 1 - sim))); 
            }
        }
        distanceMatrix.push(row);
    }
    
    if (onProgress) onProgress("Running hierarchical clustering...");
    const tree = hclust.agnes(distanceMatrix, { method: 'complete' });
    const distanceCut = Math.max(0.01, Math.min(0.99, 1.0 - similarityTarget));
    const rawClusters = tree.cut(distanceCut);
    
    const tempGroups = {};
    rawClusters.forEach((cluster, idx) => {
        tempGroups[`Cluster_${idx + 1}`] = cluster.indices().map(fileIdx => files[fileIdx]).sort();
    });

    const hasTextModel = models.some(m => m.name === TEXT_MODEL || m.name.startsWith(TEXT_MODEL + ':'));
    
    let finalGroups = {};
    if (hasTextModel) {
        if (onProgress) onProgress(`Using ${TEXT_MODEL} to generate smart folder names...`);
        finalGroups = await nameClustersWithLLM(tempGroups, TEXT_MODEL);
    } else {
        if (onProgress) onProgress(`Naming clusters using common prefix algorithm...`);
        const existingNames = new Set(["Ungrouped", "Holding Area"]);
        for (const [_, clusterFiles] of Object.entries(tempGroups)) {
            const finalName = nameClusterLCS(clusterFiles, existingNames);
            finalGroups[finalName] = clusterFiles;
        }
    }
    
    return finalGroups;
}

module.exports = { performAIGrouping };
