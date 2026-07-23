#!/usr/bin/env node

const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Safe limits (NotebookLM limits: 500k words, 200MB)
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

const isDryRun = args.includes('--dry-run');
const inputDir = path.resolve(getArgValue('--input', './input'));
const outputDir = path.resolve(getArgValue('--output', './output'));

if (args.includes('--max-words')) MAX_WORDS_PER_CHUNK = parseInt(getArgValue('--max-words', MAX_WORDS_PER_CHUNK), 10);
if (args.includes('--max-mb')) MAX_BYTES_PER_CHUNK = parseInt(getArgValue('--max-mb', 180), 10) * 1024 * 1024;

if (!fs.existsSync(inputDir)) {
    console.error(`Error: Input directory '${inputDir}' does not exist.`);
    console.error(`Create the directory or specify a different one using --input <dir>`);
    process.exit(1);
}

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const CACHE_FILE = path.join(outputDir, '.compiler-cache.json');
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
    try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } 
    catch (e) { console.warn('Could not parse cache file, starting fresh.'); }
}
const saveCache = () => {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
};

// Lower priority so heavy parsing doesn't freeze the OS
try { os.setPriority(10); } catch (e) {}

(async () => {
    if (isDryRun) {
        console.log('\n===========================================');
        console.log('DRY RUN MODE ENABLED');
        console.log('No PDFs will be created. Simulating groupings...');
        console.log('===========================================\n');
    }

    const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
    if (files.length === 0) {
        console.log(`No PDFs found in ${inputDir}`);
        process.exit(0);
    }

    console.log(`Found ${files.length} PDFs. Compiling volumes...\n`);

    let currentChunkIndex = 1;
    let currentWordCount = 0;
    let currentByteSize = 0;
    let mergedPdf = isDryRun ? null : await PDFDocument.create();
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const filePath = path.join(inputDir, file);
        const stat = fs.statSync(filePath);
        const fileByteSize = stat.size;
        const cacheKey = `${file}_${stat.size}_${Math.floor(stat.mtimeMs)}`;

        let fileWordCount = 0;
        let numPages = 1;
        let pdfBytes = null;
        
        if (cache[cacheKey]) {
            fileWordCount = cache[cacheKey].wordCount;
            numPages = cache[cacheKey].numPages || 1;
            console.log(`  [${i+1}/${files.length}] Cached ${file} - Words: ${fileWordCount} (Pages: ${numPages})`);
        } else {
            pdfBytes = fs.readFileSync(filePath);
            try {
                const data = await pdfParse(pdfBytes);
                fileWordCount = data.text.trim().split(/\s+/).filter(w => w.length > 0).length;
                numPages = data.numpages || 1;
                console.log(`  [${i+1}/${files.length}] Scanned ${file} - Words: ${fileWordCount} (Pages: ${numPages})`);
                
                cache[cacheKey] = { wordCount: fileWordCount, size: stat.size, numPages };
                saveCache();
            } catch (e) {
                console.error(`  [!] Error parsing text for ${file}: ${e.message}`);
                fileWordCount = 10000; // rough estimate fallback
                numPages = 1;
            }
        }

        const avgWordsPerPage = Math.ceil(fileWordCount / numPages);
        const avgBytesPerPage = Math.ceil(fileByteSize / numPages);

        let pdf = null;
        if (!isDryRun) {
            if (!pdfBytes) pdfBytes = fs.readFileSync(filePath);
            try {
                pdf = await PDFDocument.load(pdfBytes);
            } catch (e) {
                console.error(`  [!] Error loading ${file} with pdf-lib: ${e.message}`);
                continue;
            }
        }

        let pagesToAdd = Array.from({ length: numPages }, (_, k) => k);

        while (pagesToAdd.length > 0) {
            const remainingWords = pagesToAdd.length * avgWordsPerPage;
            const remainingBytes = pagesToAdd.length * avgBytesPerPage;

            if (currentWordCount + remainingWords <= MAX_WORDS_PER_CHUNK && currentByteSize + remainingBytes <= MAX_BYTES_PER_CHUNK) {
                // Entire remaining part of the file fits in the current volume
                if (!isDryRun && pdf) {
                    try {
                        const copiedPages = await mergedPdf.copyPages(pdf, pagesToAdd);
                        copiedPages.forEach((page) => mergedPdf.addPage(page));
                    } catch (e) {
                        console.error(`  [!] Error merging ${file}: ${e.message}`);
                    }
                }
                currentWordCount += remainingWords;
                currentByteSize += remainingBytes;
                pagesToAdd = []; // Done with this file
            } else {
                // Doesn't fit entirely. How many pages CAN fit?
                let maxPagesByWords = Math.floor((MAX_WORDS_PER_CHUNK - currentWordCount) / avgWordsPerPage);
                let maxPagesByBytes = Math.floor((MAX_BYTES_PER_CHUNK - currentByteSize) / avgBytesPerPage);
                let pagesToTake = Math.min(maxPagesByWords, maxPagesByBytes, pagesToAdd.length);

                if (pagesToTake <= 0) {
                    // Current volume is full, or a single page is bigger than the chunk size
                    if (currentWordCount === 0) {
                        // Volume is empty, take at least 1 page to avoid infinite loop
                        pagesToTake = 1;
                    } else {
                        // Save current volume and start a new one
                        const outputPath = path.join(outputDir, `NotebookLM_Volume_${currentChunkIndex}.pdf`);
                        if (!isDryRun) {
                            const mergedPdfBytes = await mergedPdf.save();
                            fs.writeFileSync(outputPath, mergedPdfBytes);
                            const sizeMb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
                            console.log(`\n>>> Saved NotebookLM_Volume_${currentChunkIndex}.pdf (${sizeMb} MB) | Total Words: ~${currentWordCount}\n`);
                        } else {
                            console.log(`\n>>> [DRY RUN] Would save NotebookLM_Volume_${currentChunkIndex}.pdf | Total Words: ~${currentWordCount}\n`);
                        }
                        
                        currentChunkIndex++;
                        mergedPdf = isDryRun ? null : await PDFDocument.create();
                        currentWordCount = 0;
                        currentByteSize = 0;
                        continue; // Re-evaluate how many pages we can take with the fresh volume
                    }
                }

                // Slice the pages we can fit
                const slice = pagesToAdd.slice(0, pagesToTake);
                pagesToAdd = pagesToAdd.slice(pagesToTake);

                if (!isDryRun && pdf) {
                    try {
                        const copiedPages = await mergedPdf.copyPages(pdf, slice);
                        copiedPages.forEach((page) => mergedPdf.addPage(page));
                    } catch (e) {
                        console.error(`  [!] Error merging ${file}: ${e.message}`);
                    }
                }
                
                currentWordCount += slice.length * avgWordsPerPage;
                currentByteSize += slice.length * avgBytesPerPage;
            }
        }
    }
    
    if (currentWordCount > 0) {
        const outputPath = path.join(outputDir, `NotebookLM_Volume_${currentChunkIndex}.pdf`);
        if (!isDryRun) {
            const mergedPdfBytes = await mergedPdf.save();
            fs.writeFileSync(outputPath, mergedPdfBytes);
            const sizeMb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
            console.log(`\n>>> Saved NotebookLM_Volume_${currentChunkIndex}.pdf (${sizeMb} MB) | Total Words: ~${currentWordCount}\n`);
        } else {
            console.log(`\n>>> [DRY RUN] Would save NotebookLM_Volume_${currentChunkIndex}.pdf | Total Words: ~${currentWordCount}\n`);
        }
    }

    console.log('\nCompilation complete! Your volumes are ready for NotebookLM.');
})();
