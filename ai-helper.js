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

async function pullModelStream(modelName, onProgress) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 11434,
            path: '/api/pull',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };

        const req = http.request(options, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`Ollama API error: ${res.statusCode}`));
            }

            let buffer = '';
            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line
                
                // Throttle updates slightly to avoid flooding the UI
                const now = Date.now();
                if (!res.lastUpdate || now - res.lastUpdate > 1000) {
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const json = JSON.parse(line);
                            if (json.status && onProgress) {
                                if (json.total && json.completed) {
                                    const percent = ((json.completed / json.total) * 100).toFixed(1);
                                    onProgress(`Downloading ${modelName}: ${percent}%`);
                                } else {
                                    onProgress(`Downloading ${modelName}: ${json.status}`);
                                }
                            }
                        } catch (e) { }
                    }
                    res.lastUpdate = now;
                }
            });

            res.on('end', resolve);
        });

        req.on('error', reject);
        req.write(JSON.stringify({ name: modelName, stream: true }));
        req.end();
    });
}

async function ensureModel(modelName, onProgress) {
    const models = await checkOllama();
    const hasModel = models.some(m => m.name === modelName || m.name.startsWith(modelName + ':'));
    
    if (!hasModel) {
        if (onProgress) onProgress(`Starting download for ${modelName}...`);
        await pullModelStream(modelName, onProgress);
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
    
    const checkExists = (n) => {
        const lowerN = n.toLowerCase();
        for (const existing of existingNames) {
            if (existing.toLowerCase() === lowerN) return true;
        }
        return false;
    };

    while (checkExists(name)) {
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

async function nameClustersWithLLM(groupedFilesMap, textModel, context, onProgress) {
    const clusters = Object.values(groupedFilesMap);
    
    let prompt = `
You are an expert file organizer. Given a list of filenames belonging to a single group, reply with a SHORT, professional folder name that best represents them.
RULES:
1. Output ONLY the folder name, nothing else. No quotes, no markdown, no explanation.
2. The name should be 1-3 words.
3. Use CamelCase or Spaces.
`;

    if (context) {
        prompt += `\nBACKGROUND CONTEXT: ${context}\n`;
    }

    prompt += `\nFilenames:\n__FILES__`;

    const namedGroups = {};
    const existingNames = new Set(["Ungrouped", "Holding Area"]);

    let clusterIndex = 1;
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
            suggestedName = suggestedName.replace(/["']/g, '').replace(/[^a-zA-Z0-9 -_]/g, '').trim();
            suggestedName = suggestedName.replace(/^[-_]+|[-_]+$/g, ''); 
            
            if (suggestedName.length < 2) suggestedName = "Cluster";
            
            const finalName = getUniqueName(suggestedName, existingNames);
            namedGroups[finalName] = files;
            if (onProgress) onProgress(`Named cluster ${clusterIndex}/${clusters.length}: ${finalName}`);
        } catch (err) {
            const finalName = nameClusterLCS(files, existingNames);
            namedGroups[finalName] = files;
            if (onProgress) onProgress(`Named cluster ${clusterIndex}/${clusters.length} (fallback): ${finalName}`);
        }
        clusterIndex++;
    }
    
    return namedGroups;
}

async function performAIGrouping(files, similarityTarget = 0.5, textModel = 'llama3', context = '', onProgress) {
    const EMBED_MODEL = 'nomic-embed-text';
    
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

    let hasTextModel = models.some(m => m.name === textModel || m.name.startsWith(textModel + ':'));
    
    // Auto-download the text model if it doesn't exist?
    // LLMs are huge. Let's just download it if the user specified one, and tell them.
    if (!hasTextModel && textModel && textModel.toLowerCase() !== 'none') {
        if (onProgress) onProgress(`Model '${textModel}' not found. Downloading... this is a large file and may take a long time!`);
        await ensureModel(textModel, onProgress);
        hasTextModel = true;
    }
    
    let finalGroups = {};
    if (hasTextModel && textModel.toLowerCase() !== 'none') {
        if (onProgress) onProgress(`Using ${textModel} to generate smart folder names...`);
        finalGroups = await nameClustersWithLLM(tempGroups, textModel, context, onProgress);
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
