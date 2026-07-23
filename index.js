#!/usr/bin/env node

const { PDFDocument } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');
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

if (!fs.existsSync(outputDir) && !isDryRun) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Lower priority so heavy parsing doesn't freeze the OS
try { os.setPriority(10); } catch (e) {}

(async () => {
    if (isDryRun) {
        console.log('\n===========================================');
        console.log('DRY RUN MODE ENABLED');
        console.log('No PDFs will be created. Simulating groupings...');
        console.log('===========================================\n');
    }

    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.pdf')).sort();
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
        const pdfBytes = fs.readFileSync(filePath);
        
        let fileWordCount = 0;
        try {
            const parser = new PDFParse({ data: pdfBytes });
            const data = await parser.getText();
            await parser.destroy();
            fileWordCount = data.text.trim().split(/\s+/).filter(w => w.length > 0).length;
            console.log(`  [${i+1}/${files.length}] Scanned ${file} - Words: ${fileWordCount}`);
        } catch (e) {
            console.error(`  [!] Error parsing text for ${file}: ${e.message}`);
            fileWordCount = 10000; // rough estimate fallback
        }

        // Check limits before adding
        if ((currentWordCount + fileWordCount > MAX_WORDS_PER_CHUNK || currentByteSize + pdfBytes.byteLength > MAX_BYTES_PER_CHUNK) && currentWordCount > 0) {
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
        }

        if (!isDryRun) {
            try {
                const pdf = await PDFDocument.load(pdfBytes);
                const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                copiedPages.forEach((page) => mergedPdf.addPage(page));
            } catch (e) {
                console.error(`  [!] Error merging ${file}: ${e.message}`);
            }
        }
        currentWordCount += fileWordCount;
        currentByteSize += pdfBytes.byteLength;
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
