# NotebookLM PDF Compiler

A standalone, multi-threaded CLI tool that stitches massive directories of PDFs together into beautifully optimized "Volumes" that perfectly comply with Google NotebookLM's strict upload limits.

NotebookLM has incredibly strict constraints that make uploading bulk documents difficult *(limits understood to be accurate at the time of writing, July 2026)*:
1. **Maximum 500,000 words** per source.
2. **Maximum 200MB** file size per source.
3. **Hard Limit of 50 sources** per notebook.

If you are uploading massive datasets, archives, or textbooks, manually chunking PDFs to fit these constraints is impossible. This tool does it for you by mathematically tracking the word count and byte size of your PDFs, natively compressing them to maximize your 50-source limit, and automatically slicing them into `Volume_1.pdf`, `Volume_2.pdf`, etc.

## Prerequisites
This tool heavily leverages system binaries for safe, high-fidelity PDF manipulation without destroying memory limits. You must have the following installed on your system PATH:
*   **Ghostscript (`gs`)**: Used for slicing and stitching PDFs safely.
*   **ExifTool (`exiftool`)**: Used to extract and inject XMP metadata across stitched volumes.
*   *(Mac Only)* **Clop (`clop`)**: Highly recommended. If installed, the compiler uses Clop for vastly superior image compression. You can find more about it on their [main website](https://lowtechguys.com/clop/) or their [GitHub repository](https://github.com/FuzzyIdeas/Clop).

## Installation

### Local Source
```bash
git clone https://github.com/webziggy/notebooklm-pdf-compiler.git
cd notebooklm-pdf-compiler
npm install
```

### Global CLI Installation (Recommended)
You can install this tool globally on your system to run it from any directory.
Inside the project folder, run:
```bash
npm link
```
You can now execute the compiler anywhere on your machine simply by typing:
```bash
notebooklm-compiler [options]
```
*Note: The global CLI automatically removes Node's artificial memory limits by provisioning an 8GB V8 sandbox under the hood so you never encounter `heap out of memory` errors on massive PDFs. This does **not** pre-allocate 8GB of RAM, so it is completely safe to run on computers with lower physical memory.*

## Core Workflow

### 1. Generating Groups (Optional)
If you want your PDFs stitched into logical categories rather than one massive clump, you can auto-generate a grouping map. 
```bash
notebooklm-compiler --suggest-groups
```
By default, this looks for an existing `files-cache.json` (exported from Box). If one doesn't exist, it falls back to a default Regular Expression (`^([A-Za-z]+)-`) which groups files by their prefix (e.g., `DOC-001.pdf` and `DOC-002.pdf` become group "DOC").

**Custom Regex Grouping:**
You can also explicitly pass your own Regular Expression to define how files should be grouped! The compiler will group files based on the first captured group `( ... )` in your regex.
```bash
notebooklm-compiler --suggest-groups "^([A-Za-z0-9]+)_"
```

This scans your `input/` folder and creates a `groups.json` file. You can manually edit this JSON file to dictate exactly which PDFs get stitched together into specific volumes.

### 2. Compiling and Compressing
To run the full compiler using your groups file:
```bash
notebooklm-compiler --groups groups.json --compress
```

### CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--input <dir>` | Directory containing your source PDFs | `./input` |
| `--output <dir>` | Directory where the stitched volumes will be saved | `./output` |
| `--logs <dir>` | Directory where the log files will be saved | `./logs` |
| `--groups <file>` | Path to your `groups.json` file | (None) |
| `--suggest-groups` | Auto-scans `input/` and builds a `groups.json` | `false` |
| `--compress` | Enables Pre-Compression caching (Highly Recommended) | `false` |
| `--dry-run` | Simulates the chunking math without writing actual PDFs | `false` |
| `--max-words` | The maximum word count per volume | `450000` (Leaves 50k buffer) |
| `--max-mb` | The maximum physical file size per volume | `180` (Leaves 20MB buffer) |

## Hidden Files & The Cache System (`.compiler-cache/`)
When you use the `--compress` flag, the compiler spins up multi-threaded background workers to physically compress your PDFs *before* doing the math to split them. This is critical because it minimizes unnecessary splits and prevents you from wasting your 50 NotebookLM source slots.

Because compressing massive PDFs takes a lot of CPU time, the compiler **permanently caches** the compressed versions in a hidden directory: `./output/.compiler-cache/compressed/`.

**⚠️ Storage Warning:** 
If you are compiling hundreds of megabytes of PDFs, this hidden `.compiler-cache` folder will grow quite large. If you are running low on disk space, **it is completely safe to delete the `.compiler-cache/` folder**. The compiler will simply regenerate it the next time you run it.

## Logging
The compiler generates extensive, timestamped logs natively routed to a `./logs/compiler.log` file.
*   **Rotation:** The log file is automatically rotated when it reaches 5MB to prevent it from bloating your disk space.
*   **Worker Streams:** Multi-threaded compression progress is securely streamed into this log file so you can always see exactly what the background processes are doing.

## Verification Tip
Once you've uploaded your compiled volumes into NotebookLM, it's always a good idea to verify that the ingestion worked perfectly. You can use the following prompt directly in NotebookLM to ensure nothing was cut off:

> *"Please check that all of the sources have imported correctly due to the 500,000 word limit in NotebookLM (as far as I am aware) - see if any were truncated."*

NotebookLM will scan its internal metadata and should respond with something like: *"There are no system warnings indicating that any of the files exceeded the 500,000-word limit or were truncated."* (NotebookLM secretly injects a 'truncated' flag into sources that breach the limit, so this prompt forces it to reveal that flag).

## Known Limitations: Accessibility Tagging
While this tool perfectly prepares raw text and preserves both **Bookmarks (Document Outlines)** and **XMP Metadata** during the merge process, it currently **does not preserve strict `<Part>` or `<Document>` Accessibility Tag grouping** (`StructTreeRoot`). We intentionally omit this to keep the compiler a lightweight Node.js CLI tool.

If you plan to read these compiled volumes locally with a screen reader, note that the reading order might rely on physical layout rather than strict logical tags.

## Disclaimer
This project is open-source and not affiliated with Google or NotebookLM.
