#!/usr/bin/env node

const { isMainThread, parentPort, workerData, Worker } = require('worker_threads');
const util = require('util');
const pdfParse = require('pdf-parse');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ==========================================
// WORKER THREAD LOGIC
// ==========================================
if (!isMainThread) {
    async function processFile() {
        const { filePath, file, compress, tempDir, maxWords, timeout } = workerData;
        let activePath = filePath;
        let finalSize = 0;
        
        try {
            const statOriginal = fs.statSync(filePath);
            
            if (compress) {
                if (statOriginal.size < 1024) {
                    throw new Error("File is corrupted or empty (under 1KB). Skipping compression.");
                }

                const compPath = path.join(tempDir, 'compressed_' + file.replace(/[^a-zA-Z0-9.-]/g, '_'));
                const tmpCompPath = path.join(tempDir, `tmp_${Date.now()}_${Math.floor(Math.random()*1000)}.pdf`);
                if (!fs.existsSync(compPath)) {
                    parentPort.postMessage({ type: 'log', message: `[Worker] Compressing ${file} (Original Size: ${(statOriginal.size / (1024*1024)).toFixed(2)} MB)...` });
                    // Default to Clop for vastly superior image compression, fallback to GS if clop fails
                    const clopCmd = `nice -n 10 clop optimise pdf --output "${tmpCompPath}" "${filePath}"`;
                    const gsCmd = `nice -n 10 gs -dBATCH -dNOPAUSE -q -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook -sOutputFile="${tmpCompPath}" "${filePath}"`;
                    try {
                        execSync(clopCmd, { stdio: 'ignore', timeout: timeout, killSignal: 'SIGKILL' }); 
                    } catch (e) {
                        if (e.code === 'ETIMEDOUT' || e.signal === 'SIGKILL') {
                            throw new Error('TIMEOUT_FATAL');
                        }
                        try {
                            execSync(gsCmd, { stdio: 'ignore', timeout: timeout, killSignal: 'SIGKILL' });
                        } catch (innerE) {
                            if (innerE.code === 'ETIMEDOUT' || innerE.signal === 'SIGKILL') {
                                throw new Error('TIMEOUT_FATAL');
                            }
                            throw new Error("Both Clop and Ghostscript failed.");
                        }
                    }
                    if (fs.existsSync(tmpCompPath)) {
                        fs.renameSync(tmpCompPath, compPath);
                    } else {
                        throw new Error("Compression failed: No output file generated.");
                    }
                    const newStat = fs.statSync(compPath);
                    parentPort.postMessage({ type: 'log', message: `[Worker] Finished ${file} (New Size: ${(newStat.size / (1024*1024)).toFixed(2)} MB)` });
                }
                activePath = compPath;
            }
            
            const stat = fs.statSync(activePath);
            finalSize = stat.size;

            const pdfBytes = fs.readFileSync(activePath);
            let wordCount = 0;
            let numPages = 1;

            try {
                const data = await pdfParse(pdfBytes);
                wordCount = data.text.trim().split(/\s+/).filter(w => w.length > 0).length;
                numPages = data.numpages || 1;
            } catch (e) {
                try {
                    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
                    numPages = pdfDoc.getPageCount();
                    wordCount = Math.floor(finalSize / 150); // Heuristic fallback
                } catch (innerErr) {
                    wordCount = maxWords; // Max out to force splitting
                    numPages = 1;
                }
            }
            
            parentPort.postMessage({ success: true, wordCount, numPages, size: finalSize, compressedPath: compress ? activePath : null });
        } catch (err) {
            parentPort.postMessage({ success: false, error: err.message, isFatal: err.message === 'TIMEOUT_FATAL' });
        }
    }
    
    processFile();
    return; // End worker execution
}

// ==========================================
// MAIN THREAD LOGIC
// ==========================================
let MAX_WORDS_PER_CHUNK = 450000;
let MAX_BYTES_PER_CHUNK = 180 * 1024 * 1024; // 180 MB

const args = process.argv.slice(2);

const validOptions = new Set([
    '--help', '-h', '--input', '--output', '--logs', '--groups', 
    '--suggest-groups', '--smart-groups', '--similarity', '--grouping-ui',
    '--compress', '--dry-run', '--max-words', '--max-mb', '--timeout'
]);

for (const arg of args) {
    if (arg.startsWith('-') && !validOptions.has(arg)) {
        console.error(`\n[!] Error: Unknown option '${arg}'`);
        console.log(`Run 'notebooklm-compiler --help' for usage instructions.\n`);
        process.exit(1);
    }
}

if (args.includes('--help') || args.includes('-h')) {
    console.log(`
NotebookLM PDF Compiler
=======================
Stitches multiple PDFs together into chunked volumes that perfectly comply with 
Google NotebookLM's strict upload limits (max 500,000 words & max 200MB per file).

Usage:
  notebooklm-compiler [options]

Options:
  --input <dir>      Directory containing the source PDFs (default: ./input)
  --output <dir>     Directory to save the compiled volumes (default: ./output)
  --logs <dir>       Directory to save the compiler logs (default: ./logs)
  --groups <file>    Path to a JSON file mapping folders/groups to file arrays.
  --suggest-groups   Automatically scan input/ and generate 'groups.json' using regex
  --smart-groups     Intelligently cluster files using Machine Learning (AGNES)
  --similarity <num> Tune the ML clustering strictness from 0.1 to 0.9 (default: 0.4)
  --grouping-ui      Launch a beautiful web interface to visually drag-and-drop groups
  --compress         Enable Ghostscript pre-compression to maximize source slot efficiency
  --ai               Use Ollama for smart semantic clustering
  --ai-model <model> Ollama model to use for smart naming (default: llama3)
  --ai-context <ctx> Additional context prompt to guide the LLM naming
  --dry-run          Simulate the grouping without generating actual PDFs
  --max-words <num>  Override the default word limit (default: 450000)
  --max-mb <num>     Override the default file size limit in MB (default: 180)
  --timeout <min>    Max minutes to allow Ghostscript/Clop to compress a single file (default: 5)
  --help, -h         Show this help message
`);
    process.exit(0);
}

const getArgValue = (flag, defaultValue) => {
    const index = args.indexOf(flag);
    if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('-')) {
        return args[index + 1];
    }
    return defaultValue;
};

const inputDir = path.resolve(getArgValue('--input', './input'));
const outputDir = path.resolve(getArgValue('--output', './output'));
const logsDir = path.resolve(getArgValue('--logs', './logs'));
const isDryRun = args.includes('--dry-run');
const doCompress = args.includes('--compress');
const compressionTimeoutMs = parseInt(getArgValue('--timeout', 5), 10) * 60 * 1000;
const runAi = args.includes('--ai');
const aiModel = getArgValue('--ai-model', 'llama3');
const aiContext = getArgValue('--ai-context', '');

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Setup File Logging with Rotation
const logFile = path.join(logsDir, 'compiler.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

function rotateLog() {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_SIZE) {
        fs.renameSync(logFile, path.join(logsDir, `compiler_${Date.now()}.log`));
    }
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = function(...args) {
    rotateLog();
    const msg = util.format(...args);
    originalLog(msg);
    const ts = new Date().toISOString();
    fs.appendFileSync(logFile, `[${ts}] ${msg}\n`);
};

console.warn = function(...args) {
    rotateLog();
    const msg = util.format(...args);
    originalWarn(msg);
    const ts = new Date().toISOString();
    fs.appendFileSync(logFile, `[${ts}] [WARN] ${msg}\n`);
};

console.error = function(...args) {
    rotateLog();
    const msg = util.format(...args);
    originalError(msg);
    const ts = new Date().toISOString();
    fs.appendFileSync(logFile, `[${ts}] [ERROR] ${msg}\n`);
};

if (args.includes('--max-words')) MAX_WORDS_PER_CHUNK = parseInt(getArgValue('--max-words', MAX_WORDS_PER_CHUNK), 10);
if (args.includes('--max-mb')) MAX_BYTES_PER_CHUNK = parseInt(getArgValue('--max-mb', 180), 10) * 1024 * 1024;

if (!fs.existsSync(inputDir)) {
    console.error(`Error: Input directory '${inputDir}' does not exist.`);
    process.exit(1);
}

// Phase 2.0: Grouping UI
if (args.includes('--grouping-ui')) {
    const { startUI } = require('./ui-server.js');
    startUI(inputDir, 'groups.json');
    return; // Halt CLI, wait for UI server to exit process on save
}

// Phase 2.1: Auto-Grouping logic
if (args.includes('--suggest-groups') || args.includes('--smart-groups') || runAi) {
    const isSmartGroups = args.includes('--smart-groups');
    const groupsOutput = 'groups.json';
    const groups = {};
    const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    const fileSet = new Set(files);
    
    if (runAi) {
        console.log(`\n[AI-Group] Running smart semantic clustering via Ollama (Naming model: ${aiModel})...`);
        if (aiContext) console.log(`[AI-Group] Using context: "${aiContext}"`);
        const similarityTarget = parseFloat(getArgValue('--similarity', '0.5'));
        
        try {
            const resultGroups = require('child_process').execSync(`node -e "
                const { performAIGrouping } = require('./ai-helper');
                (async () => {
                    try {
                        const res = await performAIGrouping(${JSON.stringify(files)}, ${similarityTarget}, '${aiModel}', ${JSON.stringify(aiContext)}, (msg) => console.log(msg));
                        console.log('__JSON_START__' + JSON.stringify(res) + '__JSON_END__');
                    } catch(err) {
                        console.error('__ERR_START__' + err.message + '__ERR_END__');
                    }
                })();
            "`, { stdio: 'pipe', encoding: 'utf-8' });
            
            const errMatch = resultGroups.match(/__ERR_START__(.*?)__ERR_END__/s);
            if (errMatch) throw new Error(errMatch[1]);
            
            const match = resultGroups.match(/__JSON_START__(.*?)__JSON_END__/s);
            if (!match) throw new Error("Failed to parse AI output.");
            
            const outputJSON = JSON.parse(match[1]);
            Object.assign(groups, outputJSON);
            
            // Re-print the console logs from the child process that aren't our JSON strings
            const logs = resultGroups.replace(/__(JSON|ERR)_START__.*?__(JSON|ERR)_END__/gs, '').trim();
            if (logs) console.log(logs);
            
        } catch (err) {
            console.error(`\n❌ AI Grouping Failed: ${err.message}`);
            console.log("Please ensure Ollama is running (\`ollama serve\`) and accessible.");
            process.exit(1);
        }
    } else if (isSmartGroups) {
        console.log(`\nAnalyzing ${files.length} files using Machine Learning (AGNES) clustering...`);
        const stringSimilarity = require('string-similarity');
        const hclust = require('ml-hclust');

        // Create distance matrix (1 - similarity)
        const distanceMatrix = [];
        for (let i = 0; i < files.length; i++) {
            const row = [];
            for (let j = 0; j < files.length; j++) {
                if (i === j) {
                    row.push(0);
                } else if (j < i) {
                    row.push(distanceMatrix[j][i]); // Symmetry
                } else {
                    const sim = stringSimilarity.compareTwoStrings(files[i], files[j]);
                    row.push(1 - sim); // distance = 1 - similarity
                }
            }
            distanceMatrix.push(row);
        }

        // Run AGNES hierarchical clustering
        const tree = hclust.agnes(distanceMatrix, { method: 'complete' });
        
        // Convert user similarity preference (e.g. 0.4) to distance cutoff (0.6)
        const similarityTarget = parseFloat(getArgValue('--similarity', '0.4'));
        const distanceCut = Math.max(0.01, Math.min(0.99, 1.0 - similarityTarget));
        
        console.log(`Using similarity threshold of ${similarityTarget} (Distance Cutoff: ${distanceCut.toFixed(2)})`);
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
        const cachePath = path.join(inputDir, 'files-cache.json');
        if (fs.existsSync(cachePath)) {
            console.log(`Found files-cache.json, building groups based on Box folders...`);
            const boxCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            boxCache.forEach(item => {
                const filename = item.name + '.pdf';
                if (fileSet.has(filename)) {
                    let folder = item.folder || "Ungrouped";
                    folder = folder.replace(/[^a-zA-Z0-9 -_]/g, '_').trim(); // sanitize
                    if (!groups[folder]) groups[folder] = [];
                    groups[folder].push(filename);
                }
            });
        } else {
            const regexStr = getArgValue('--suggest-groups', '^([A-Za-z]+)-');
            const regex = new RegExp(regexStr);
            files.forEach(f => {
                const match = f.match(regex);
                const groupName = match ? match[1] : 'Ungrouped';
                if (!groups[groupName]) groups[groupName] = [];
                groups[groupName].push(f);
            });
        }
    }

    const groupedFiles = new Set(Object.values(groups).flat());
    groups["Ungrouped"] = groups["Ungrouped"] || [];
    files.forEach(f => {
        if (!groupedFiles.has(f)) groups["Ungrouped"].push(f);
    });
    if (groups["Ungrouped"].length === 0) delete groups["Ungrouped"];

    // ASCII Tree Reporting
    console.log('\nGroups Generated:');
    const groupKeys = Object.keys(groups);
    groupKeys.forEach((key, gIdx) => {
        const isLastGroup = gIdx === groupKeys.length - 1;
        const gPrefix = isLastGroup ? '└── ' : '├── ';
        const cPrefix = isLastGroup ? '    ' : '│   ';
        console.log(`${gPrefix}${key} (${groups[key].length} files)`);
        
        groups[key].forEach((file, fIdx) => {
            const isLastFile = fIdx === groups[key].length - 1;
            const fPrefix = isLastFile ? '└── ' : '├── ';
            console.log(`${cPrefix}${fPrefix}${file}`);
        });
    });

    fs.writeFileSync(groupsOutput, JSON.stringify(groups, null, 2));
    console.log(`\nSaved to ${groupsOutput}!`);
    console.log(`You can manually edit ${groupsOutput} before running the compiler.`);
    console.log(`To compile, run: notebooklm-compiler --groups ${groupsOutput} --compress\n`);
    process.exit(0);
}

const CACHE_FILE = path.join(outputDir, '.compiler-cache.json');
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
    try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } 
    catch (e) { console.warn('Could not parse cache file, starting fresh.'); }
}
const saveCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

// Lower OS priority for safety
try { os.setPriority(10); } catch (e) {}

// Setup Temp Dirs
const tempDir = path.join(os.tmpdir(), 'pdf_compiler_slices');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const compCacheDir = path.join(outputDir, '.compiler-cache', 'compressed');
if (doCompress && !fs.existsSync(compCacheDir)) {
    fs.mkdirSync(compCacheDir, { recursive: true });
}

function runWorker(taskData) {
    return new Promise((resolve) => {
        const worker = new Worker(__filename, { workerData: taskData });
        worker.on('message', (msg) => {
            if (msg.type === 'log') {
                console.log(msg.message);
            } else {
                resolve(msg);
            }
        });
        worker.on('error', (err) => resolve({ success: false, error: err.message }));
        worker.on('exit', () => resolve({ success: false, error: 'Worker exited' }));
    });
}

async function finalizeVolume(groupName, chunkIndex, volFiles, wordCount) {
    const volName = `Volume_${chunkIndex}_${groupName}`.replace(/_+/g, '_');
    const outputPath = path.join(outputDir, `${volName}.pdf`);
    
    if (isDryRun) {
        console.log(`>>> [DRY RUN] Would save ${volName}.pdf | Total Words: ~${wordCount}`);
        return;
    }

    console.log(`\n>>> Merging ${volName}.pdf...`);
    
    const gsInputs = [];
    for (const f of volFiles) {
        if (f.isFullFile) {
            gsInputs.push(`"${f.path}"`);
        } else {
            const slicePath = path.join(tempDir, `slice_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);
            const cmd = `nice -n 10 gs -dBATCH -dNOPAUSE -q -sDEVICE=pdfwrite -dFirstPage=${f.startPage} -dLastPage=${f.endPage} -sOutputFile="${slicePath}" "${f.path}"`;
            try {
                execSync(cmd, { stdio: 'ignore' });
                gsInputs.push(`"${slicePath}"`);
                f.tempSlicePath = slicePath;
            } catch (e) {
                console.error(`  [!] Ghostscript slice error: ${e.message}`);
            }
        }
    }

    if (gsInputs.length > 0) {
        // Output standard merge (pre-compression already happened if enabled)
        const mergeCmd = `nice -n 10 gs -dBATCH -dNOPAUSE -q -sDEVICE=pdfwrite -sOutputFile="${outputPath}" ${gsInputs.join(' ')}`;
        try {
            execSync(mergeCmd, { stdio: 'ignore' });
        } catch (e) {
            console.error(`  [!] Ghostscript merge error: ${e.message}`);
        }
    }

    console.log(`    > Compiling XMP Metadata via exiftool...`);
    let combinedXmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n`;
    
    const processedXmp = new Set();
    for (const f of volFiles) {
        if (processedXmp.has(f.originalName)) continue;
        processedXmp.add(f.originalName);
        try {
            const xmpStr = execSync(`exiftool -XMP -b "${f.originalSourcePath}"`, { encoding: 'utf8' });
            const match = xmpStr.match(/<rdf:Description[\s\S]*?<\/rdf:Description>/g);
            if (match) {
                combinedXmp += `\n<!-- Source File: ${f.originalName} -->\n`;
                combinedXmp += match.join('\n');
            }
        } catch (e) { }
    }
    combinedXmp += `\n</rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;
    const xmpTemp = path.join(tempDir, `xmp_${Date.now()}.xmp`);
    fs.writeFileSync(xmpTemp, combinedXmp);

    try {
        execSync(`exiftool -overwrite_original "-xmp<=${xmpTemp}" "${outputPath}"`, { stdio: 'ignore' });
    } catch (e) {
        console.error(`  [!] Exiftool injection error: ${e.message}`);
    }
    if (fs.existsSync(xmpTemp)) fs.unlinkSync(xmpTemp);

    console.log(`    > Creating Sidecar TOC...`);
    const tocPath = path.join(outputDir, `${volName}_TOC.md`);
    let tocContent = `# Table of Contents: ${volName}\n\n`;
    let currentInternalPage = 1;

    for (const f of volFiles) {
        const pagesInSlice = f.endPage - f.startPage + 1;
        tocContent += `- **${f.originalName}** (Source Pages: ${f.startPage}-${f.endPage}) -> Volume Pages: ${currentInternalPage}-${currentInternalPage + pagesInSlice - 1}\n`;
        currentInternalPage += pagesInSlice;
    }
    fs.writeFileSync(tocPath, tocContent);

    for (const f of volFiles) {
        if (f.tempSlicePath && fs.existsSync(f.tempSlicePath)) fs.unlinkSync(f.tempSlicePath);
    }
    
    const sizeMb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
    console.log(`>>> Saved ${volName}.pdf (${sizeMb} MB) | Total Words: ~${wordCount}\n`);
}

(async () => {
    if (isDryRun) {
        console.log('\n===========================================');
        console.log('DRY RUN MODE ENABLED');
        console.log('No PDFs will be created. Simulating groupings...');
        console.log('===========================================\n');
    }

    let groupsMap = {};
    const groupsFileParam = getArgValue('--groups');
    if (groupsFileParam) {
        const groupsPath = path.resolve(groupsFileParam);
        if (!fs.existsSync(groupsPath)) {
            console.error(`Error: Groups file not found at ${groupsPath}`);
            process.exit(1);
        }
        groupsMap = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
    } else {
        const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
        if (files.length === 0) {
            console.log(`No PDFs found in ${inputDir}`);
            process.exit(0);
        }
        groupsMap["Ungrouped"] = files;
    }

    // ==========================================
    // PRE-PROCESSING STAGE (MULTI-THREADED)
    // ==========================================
    const tasks = [];
    for (const [groupName, groupFiles] of Object.entries(groupsMap)) {
        for (const file of groupFiles) {
            const filePath = path.join(inputDir, file);
            if (!fs.existsSync(filePath)) continue;
            
            const stat = fs.statSync(filePath);
            const cacheKey = `${doCompress ? 'comp_' : ''}${file}_${stat.size}_${Math.floor(stat.mtimeMs)}`;
            
            if (!cache[cacheKey]) {
                tasks.push({ filePath, file, compress: doCompress, tempDir: compCacheDir, maxWords: MAX_WORDS_PER_CHUNK, cacheKey, timeout: compressionTimeoutMs });
            }
        }
    }

    if (tasks.length > 0) {
        console.log(`\n===========================================`);
        console.log(`Pre-processing ${tasks.length} new/modified files via Worker Threads...`);
        console.log(`===========================================\n`);
        
        const MAX_CONCURRENCY = Math.min(os.cpus().length, 4); // Cap at 4 to prevent OOM on huge PDFs
        let i = 0;
        let completed = 0;

        const workers = Array(MAX_CONCURRENCY).fill(null).map(async () => {
            while (i < tasks.length) {
                const task = tasks[i++];
                const result = await runWorker(task);
                if (result.success) {
                    cache[task.cacheKey] = {
                        wordCount: result.wordCount,
                        size: result.size,
                        numPages: result.numPages,
                        compressedPath: result.compressedPath
                    };
                    saveCache();
                    completed++;
                    const sizeMb = (result.size / (1024 * 1024)).toFixed(2);
                    console.log(`  [${completed}/${tasks.length}] Processed ${task.file} - Words: ${result.wordCount} (Pages: ${result.numPages}, Size: ${sizeMb} MB)`);
                } else {
                    console.error(`  [!] Failed to process ${task.file}: ${result.error}`);
                    if (result.isFatal) {
                        console.error(`\n[CRITICAL ERROR] Compression timed out on ${task.file}.`);
                        console.error(`The process was forcefully killed because it exceeded the ${compressionTimeoutMs / 60000} minute limit.`);
                        console.error(`ACTION REQUIRED:`);
                        console.error(`1. If this is a massive, valid PDF, increase the timeout: --timeout ${Math.ceil((compressionTimeoutMs / 60000) * 2)}`);
                        console.error(`2. If this is a corrupted/empty file, remove it from your input folder.`);
                        console.error(`Exiting compiler to prevent infinite hangs.\n`);
                        process.exit(1);
                    }
                }
            }
        });
        await Promise.all(workers);
    }

    // ==========================================
    // CHUNKING & MERGING STAGE
    // ==========================================
    for (const [groupName, groupFiles] of Object.entries(groupsMap)) {
        if (groupFiles.length === 0) continue;
        console.log(`\n===========================================`);
        console.log(`Compiling Group: ${groupName} (${groupFiles.length} files)`);
        console.log(`===========================================\n`);
        
        const safeGroupName = groupName.replace(/[^a-zA-Z0-9 -_]/g, '_').replace(/_+/g, '_').trim();
        let currentChunkIndex = 1;
        let currentWordCount = 0;
        let currentByteSize = 0;
        let currentVolumeFiles = [];

        for (let i = 0; i < groupFiles.length; i++) {
            const file = groupFiles[i];
            const originalFilePath = path.join(inputDir, file);
            if (!fs.existsSync(originalFilePath)) {
                console.warn(`  [!] File not found, skipping: ${file}`);
                continue;
            }
            
            const stat = fs.statSync(originalFilePath);
            const cacheKey = `${doCompress ? 'comp_' : ''}${file}_${stat.size}_${Math.floor(stat.mtimeMs)}`;

            if (!cache[cacheKey]) {
                console.warn(`  [!] Missing cache for ${file}, skipping (should have been pre-processed).`);
                continue;
            }

            const cData = cache[cacheKey];
            const fileWordCount = cData.wordCount;
            const numPages = cData.numPages;
            const finalSize = cData.size;
            const activePath = cData.compressedPath || originalFilePath;

            const sizeMb = (finalSize / (1024 * 1024)).toFixed(2);
            console.log(`  [${i+1}/${groupFiles.length}] Chunking ${file} - Words: ${fileWordCount} (Pages: ${numPages}, Size: ${sizeMb} MB)`);

            const avgWordsPerPage = Math.ceil(fileWordCount / numPages);
            const avgBytesPerPage = Math.ceil(finalSize / numPages);

            let remainingPages = numPages;
            let currentStartPage = 1;

            while (remainingPages > 0) {
                const remainingWords = remainingPages * avgWordsPerPage;
                const remainingBytes = remainingPages * avgBytesPerPage;

                if (currentWordCount + remainingWords <= MAX_WORDS_PER_CHUNK && currentByteSize + remainingBytes <= MAX_BYTES_PER_CHUNK) {
                    currentVolumeFiles.push({
                        path: activePath,
                        originalSourcePath: originalFilePath,
                        startPage: currentStartPage,
                        endPage: currentStartPage + remainingPages - 1,
                        originalName: file,
                        isFullFile: (currentStartPage === 1 && remainingPages === numPages)
                    });
                    currentWordCount += remainingWords;
                    currentByteSize += remainingBytes;
                    remainingPages = 0;
                } else {
                    let maxPagesByWords = Math.floor((MAX_WORDS_PER_CHUNK - currentWordCount) / avgWordsPerPage);
                    let maxPagesByBytes = Math.floor((MAX_BYTES_PER_CHUNK - currentByteSize) / avgBytesPerPage);
                    let pagesToTake = Math.min(maxPagesByWords, maxPagesByBytes, remainingPages);

                    if (pagesToTake <= 0) {
                        if (currentWordCount === 0) {
                            pagesToTake = 1;
                        } else {
                            await finalizeVolume(safeGroupName, currentChunkIndex, currentVolumeFiles, currentWordCount);
                            currentChunkIndex++;
                            currentVolumeFiles = [];
                            currentWordCount = 0;
                            currentByteSize = 0;
                            continue;
                        }
                    }

                    currentVolumeFiles.push({
                        path: activePath,
                        originalSourcePath: originalFilePath,
                        startPage: currentStartPage,
                        endPage: currentStartPage + pagesToTake - 1,
                        originalName: file,
                        isFullFile: false
                    });
                    currentWordCount += pagesToTake * avgWordsPerPage;
                    currentByteSize += pagesToTake * avgBytesPerPage;
                    remainingPages -= pagesToTake;
                    currentStartPage += pagesToTake;
                }
            }
        }
        
        if (currentVolumeFiles.length > 0) {
            await finalizeVolume(safeGroupName, currentChunkIndex, currentVolumeFiles, currentWordCount);
        }
    }

    console.log('\nCompilation complete! Your volumes are ready for NotebookLM.');
})();
