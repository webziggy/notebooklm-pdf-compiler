#!/usr/bin/env node

const util = require('util');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

let MAX_WORDS_PER_CHUNK = 450000;
let MAX_BYTES_PER_CHUNK = 180 * 1024 * 1024; // 180 MB

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
NotebookLM PDF Compiler
=======================
Stitches multiple PDFs together into chunked volumes that perfectly comply with 
Google NotebookLM's strict upload limits (max 500,000 words & max 200MB per file).

Usage:
  node --max-old-space-size=8192 index.js [options]

Options:
  --input <dir>      Directory containing the source PDFs (default: ./input)
  --output <dir>     Directory to save the compiled volumes (default: ./output)
  --groups <file>    Path to a JSON file mapping folders/groups to file arrays.
  --suggest-groups   Automatically scan input/ and generate 'groups.json' (reads files-cache.json if present)
  --dry-run          Simulate the grouping without generating actual PDFs
  --max-words <num>  Override the default word limit (default: 450000)
  --max-mb <num>     Override the default file size limit in MB (default: 180)
  --help, -h         Show this help message
`);
    process.exit(0);
}

const getArgValue = (flag, defaultValue) => {
    const index = args.indexOf(flag);
    return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const inputDir = path.resolve(getArgValue('--input', './input'));
const outputDir = path.resolve(getArgValue('--output', './output'));
const logsDir = path.resolve(getArgValue('--logs', './logs'));
const isDryRun = args.includes('--dry-run');

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

// Phase 2.1: Auto-Grouping logic
if (args.includes('--suggest-groups')) {
    const groupsOutput = 'groups.json';
    const groups = {};
    const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    const fileSet = new Set(files);
    
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

    // Catch missing
    const groupedFiles = new Set(Object.values(groups).flat());
    groups["Ungrouped"] = groups["Ungrouped"] || [];
    files.forEach(f => {
        if (!groupedFiles.has(f)) groups["Ungrouped"].push(f);
    });
    if (groups["Ungrouped"].length === 0) delete groups["Ungrouped"];

    fs.writeFileSync(groupsOutput, JSON.stringify(groups, null, 2));
    console.log(`\nCreated ${groupsOutput}!`);
    console.log(`You can now run: node index.js --groups ${groupsOutput}\n`);
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

// Setup Temp Dir for Slicing
const tempDir = path.join(os.tmpdir(), 'pdf_compiler_slices');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

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
            const xmpStr = execSync(`exiftool -XMP -b "${f.path}"`, { encoding: 'utf8' });
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

    for (const [groupName, groupFiles] of Object.entries(groupsMap)) {
        if (groupFiles.length === 0) continue;
        console.log(`\n===========================================`);
        console.log(`Processing Group: ${groupName} (${groupFiles.length} files)`);
        console.log(`===========================================\n`);
        
        const safeGroupName = groupName.replace(/[^a-zA-Z0-9 -_]/g, '_').replace(/_+/g, '_').trim();
        let currentChunkIndex = 1;
        let currentWordCount = 0;
        let currentByteSize = 0;
        let currentVolumeFiles = [];

        for (let i = 0; i < groupFiles.length; i++) {
            const file = groupFiles[i];
            const filePath = path.join(inputDir, file);
            if (!fs.existsSync(filePath)) {
                console.warn(`  [!] File not found, skipping: ${file}`);
                continue;
            }
            
            const stat = fs.statSync(filePath);
            const fileByteSize = stat.size;
            const cacheKey = `${file}_${stat.size}_${Math.floor(stat.mtimeMs)}`;

            let fileWordCount = 0;
            let numPages = 1;
            
            if (cache[cacheKey]) {
                fileWordCount = cache[cacheKey].wordCount;
                numPages = cache[cacheKey].numPages || 1;
                console.log(`  [${i+1}/${groupFiles.length}] Cached ${file} - Words: ${fileWordCount} (Pages: ${numPages})`);
            } else {
                const pdfBytes = fs.readFileSync(filePath);
                try {
                    const data = await pdfParse(pdfBytes);
                    fileWordCount = data.text.trim().split(/\s+/).filter(w => w.length > 0).length;
                    numPages = data.numpages || 1;
                    console.log(`  [${i+1}/${groupFiles.length}] Scanned ${file} - Words: ${fileWordCount} (Pages: ${numPages})`);
                    cache[cacheKey] = { wordCount: fileWordCount, size: stat.size, numPages };
                    saveCache();
                } catch (e) {
                    console.error(`  [!] Error parsing text for ${file}: ${e.message}`);
                    fileWordCount = 10000; 
                    numPages = 1;
                }
            }

            const avgWordsPerPage = Math.ceil(fileWordCount / numPages);
            const avgBytesPerPage = Math.ceil(fileByteSize / numPages);

            let remainingPages = numPages;
            let currentStartPage = 1;

            while (remainingPages > 0) {
                const remainingWords = remainingPages * avgWordsPerPage;
                const remainingBytes = remainingPages * avgBytesPerPage;

                if (currentWordCount + remainingWords <= MAX_WORDS_PER_CHUNK && currentByteSize + remainingBytes <= MAX_BYTES_PER_CHUNK) {
                    currentVolumeFiles.push({
                        path: filePath,
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
                        path: filePath,
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
