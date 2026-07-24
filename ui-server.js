const express = require('express');
const fs = require('fs');
const path = require('path');

function startUI(inputDir, groupsOutput) {
    const app = express();
    const port = 3000;

    app.use(express.json());
    app.use(express.static(path.join(__dirname, 'public')));

    // API to get current groups and all available files
    app.get('/api/data', (req, res) => {
        const reqFile = req.query.file;
        let targetFile = reqFile || 'groups.json';
        
        // Find all group files for versioning
        const allFiles = fs.readdirSync(path.dirname(groupsOutput));
        const groupFiles = allFiles.filter(f => f.startsWith('groups') && f.endsWith('.json')).sort();

        let groups = {};
        const targetPath = path.join(path.dirname(groupsOutput), targetFile);
        if (fs.existsSync(targetPath)) {
            groups = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        }

        const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf'));
        const groupedFiles = new Set(Object.values(groups).flat());
        
        const ungrouped = files.filter(f => !groupedFiles.has(f));
        groups['Ungrouped'] = ungrouped;

        res.json({ groups, groupFiles, currentFile: targetFile });
    });

    app.post('/api/auto-group', async (req, res) => {
        const { type, similarity } = req.body;
        const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf'));
        let groups = {};

        if (type === 'smart') {
            const stringSimilarity = require('string-similarity');
            const hclust = require('ml-hclust');
            const distanceMatrix = [];
            for (let i = 0; i < files.length; i++) {
                const row = [];
                for (let j = 0; j < files.length; j++) {
                    if (i === j) row.push(0);
                    else if (j < i) row.push(distanceMatrix[j][i]);
                    else row.push(1 - stringSimilarity.compareTwoStrings(files[i], files[j]));
                }
                distanceMatrix.push(row);
            }
            const tree = hclust.agnes(distanceMatrix, { method: 'complete' });
            const similarityTarget = parseFloat(similarity) || 0.4;
            const distanceCut = Math.max(0.01, Math.min(0.99, 1.0 - similarityTarget));
            const clusters = tree.cut(distanceCut);
            
            const existingNames = new Set(["Ungrouped", "Holding Area"]);
            
            function getUniqueName(baseName) {
                let name = baseName;
                let counter = 2;
                while (existingNames.has(name)) {
                    name = `${baseName}_${counter}`;
                    counter++;
                }
                existingNames.add(name);
                return name;
            }

            clusters.forEach((cluster, idx) => {
                const clusterFiles = cluster.indices().map(fileIdx => files[fileIdx]).sort();
                
                const bases = clusterFiles.map(f => f.replace(/\.pdf$/i, ''));
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

                if (cleanName.length < 3) {
                    cleanName = "Cluster";
                }
                
                const finalName = getUniqueName(cleanName);
                groups[finalName] = clusterFiles;
            });
        } else {
            // Regex Suggest
            const regexStr = req.body.regex || '^([A-Za-z]+)-';
            let regex;
            try {
                regex = new RegExp(regexStr);
            } catch (e) {
                regex = new RegExp('^([A-Za-z]+)-'); // Fallback on invalid regex
            }
            
            files.forEach(f => {
                const match = f.match(regex);
                const groupName = match ? match[1] : 'Holding Area';
                if (!groups[groupName]) groups[groupName] = [];
                groups[groupName].push(f);
            });
        }

        const groupedFiles = new Set(Object.values(groups).flat());
        groups["Holding Area"] = groups["Holding Area"] || [];
        files.forEach(f => {
            if (!groupedFiles.has(f)) groups["Holding Area"].push(f);
        });
        if (groups["Holding Area"].length === 0) delete groups["Holding Area"];
        if (groups["Ungrouped"]) {
            groups["Holding Area"] = [...(groups["Holding Area"]||[]), ...groups["Ungrouped"]];
            delete groups["Ungrouped"];
        }

        res.json({ groups });
    });

    app.get('/api/ai-group-stream', async (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const similarity = parseFloat(req.query.similarity) || 0.5;
        const textModel = req.query.model || 'llama3';
        const context = req.query.context || '';
        const embedModel = req.query.embedModel || 'nomic-embed-text';
        const sanitize = req.query.sanitize !== 'false';
        
        const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf'));
        
        const abortController = new AbortController();
        res.on('close', () => {
            if (!res.writableEnded) {
                console.log('[AI-Group] Client disconnected, aborting task...');
                abortController.abort();
            }
        });

        try {
            const { performAIGrouping } = require('./ai-helper');
            const groups = await performAIGrouping(files, similarity, textModel, context, embedModel, sanitize, (msg) => {
                res.write(`data: ${JSON.stringify({ type: 'progress', message: msg })}\n\n`);
                console.log(`[AI-Group] ${msg}`);
            }, abortController.signal);
            
            const groupedFiles = new Set(Object.values(groups).flat());
            groups["Holding Area"] = groups["Holding Area"] || [];
            files.forEach(f => {
                if (!groupedFiles.has(f)) groups["Holding Area"].push(f);
            });
            if (groups["Holding Area"].length === 0) delete groups["Holding Area"];
            if (groups["Ungrouped"]) {
                groups["Holding Area"] = [...(groups["Holding Area"]||[]), ...groups["Ungrouped"]];
                delete groups["Ungrouped"];
            }

            res.write(`data: ${JSON.stringify({ type: 'done', groups })}\n\n`);
        } catch (err) {
            if (!abortController.signal.aborted) res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        }
        res.end();
    });

    app.get('/api/ollama-models', async (req, res) => {
        try {
            const { checkOllama } = require('./ai-helper');
            const models = await checkOllama();
            res.json({ models });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/ai-rename-stream', async (req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const { groups, model, context, sanitize } = req.body;
        const textModel = model || 'llama3';
        const shouldSanitize = sanitize !== false;
        
        const abortController = new AbortController();
        res.on('close', () => {
            if (!res.writableEnded) {
                console.log('[AI-Rename] Client disconnected, aborting task...');
                abortController.abort();
            }
        });
        
        try {
            const { nameClustersWithLLM, checkOllama, ensureModel } = require('./ai-helper');
            
            const sendMsg = (msg) => {
                res.write(JSON.stringify({ type: 'progress', message: msg }) + '\n');
                console.log(`[AI-Rename] ${msg}`);
            };
            
            sendMsg("Checking Ollama connection...");
            const models = await checkOllama();
            
            let hasTextModel = models.some(m => m.name === textModel || m.name.startsWith(textModel + ':'));
            if (!hasTextModel && textModel.toLowerCase() !== 'none') {
                sendMsg(`Model '${textModel}' not found. Downloading...`);
                await ensureModel(textModel, sendMsg);
            }
            
            if (abortController.signal.aborted) throw new Error("Operation cancelled by user.");
            
            const holdingArea = groups["Holding Area"];
            const ungrouped = groups["Ungrouped"];
            delete groups["Holding Area"];
            delete groups["Ungrouped"];
            
            sendMsg(`Using ${textModel} to generate smart folder names...`);
            const renamedGroups = await nameClustersWithLLM(groups, textModel, context || '', sendMsg, abortController.signal, shouldSanitize);
            
            if (holdingArea) renamedGroups["Holding Area"] = holdingArea;
            if (ungrouped) renamedGroups["Ungrouped"] = ungrouped;
            
            if (!abortController.signal.aborted) res.write(JSON.stringify({ type: 'done', groups: renamedGroups }) + '\n');
        } catch (err) {
            if (!abortController.signal.aborted) res.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
        }
        res.end();
    });

    // API to delete a specific version
    app.delete('/api/delete-file', (req, res) => {
        const { filename } = req.body;
        if (filename && filename.startsWith('groups') && filename.endsWith('.json')) {
            const targetPath = path.join(path.dirname(groupsOutput), filename);
            if (fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
                return res.json({ success: true });
            }
        }
        res.status(400).json({ error: "Invalid file" });
    });

    // API to save groups and shutdown
    app.post('/api/save', (req, res) => {
        const { groups } = req.body;
        // Clean up empty groups and the temporary Ungrouped bucket
        const finalGroups = {};
        for (const [groupName, files] of Object.entries(groups)) {
            if (groupName !== 'Ungrouped' && files.length > 0) {
                finalGroups[groupName] = files;
            }
        }
        
        // Save to a versioned timestamp
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const versionName = `groups_${ts}.json`;
        const versionedOutput = path.join(path.dirname(groupsOutput), versionName);
        
        fs.writeFileSync(versionedOutput, JSON.stringify(finalGroups, null, 2));
        
        // Update the main groups.json pointer to be a symlink
        if (fs.existsSync(groupsOutput) || fs.lstatSync(groupsOutput, { throwIfNoEntry: false })) {
            fs.unlinkSync(groupsOutput);
        }
        fs.symlinkSync(versionName, groupsOutput);
        
        console.log(`\n[UI] Successfully saved to ${versionedOutput} and linked groups.json!`);
        console.log(`[UI] Shutting down web server. You can now run compilation.`);
        res.json({ success: true });
        
        setTimeout(() => {
            process.exit(0);
        }, 500);
    });

    app.listen(port, async () => {
        console.log(`\n===========================================`);
        console.log(`Grouping UI server running on http://localhost:${port}`);
        console.log(`Opening your default browser...`);
        console.log(`===========================================\n`);
        const openModule = await import('open');
        await openModule.default(`http://localhost:${port}`);
    });
}

module.exports = { startUI };
