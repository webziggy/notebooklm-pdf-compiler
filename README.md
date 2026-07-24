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

## First-Time User Guide (Quick Start)
If you've just installed the tool, here is the exact step-by-step workflow you need to run to compile your first batch of PDFs:

1. **Create an Input Folder:** Create a folder named `input` in your current working directory (e.g., `mkdir input`).
2. **Add Your PDFs:** Drag and drop all the massive, unorganized PDF files you want to compile into that `input` folder.
3. **Generate Groups:** Run the following command. The compiler will scan your `input` folder and try to intelligently group them together into logical volumes based on their file names. It will generate a `groups.json` file.
   ```bash
   notebooklm-compiler --suggest-groups
   ```
4. **Compile:** Once you are happy with how `groups.json` looks, run the final compilation! This will heavily compress the files in the background and stitch them together into perfectly sized NotebookLM volumes.
   ```bash
   notebooklm-compiler --groups groups.json --compress
   ```
5. **Get Your Results:** You will find your fully compiled, optimized, and ready-to-upload PDFs sitting in the automatically generated `output/` directory!

---

## Advanced Core Workflow

### 1. Generating Groups (Optional)
If you want your PDFs stitched into logical categories rather than one massive clump, you must first generate a grouping map. The compiler offers two different ways to do this:

- `--compress` : Reduces the file size of the generated PDF chunks before compiling.
- `--grouping-ui` : Launches a beautiful drag-and-drop web interface to visually edit your groups before compiling.

> [!TIP]
> ### Which grouping strategy should you choose?
> 
> *   **Use `--suggest-groups` (Regex)** when your filenames have a strict, predictable naming convention (e.g. `INV-001.pdf`, `INV-002.pdf`, `REP-001.pdf`). This will perfectly group all `INV` files into an "INV" cluster.
> *   **Use `--smart-groups` (String Similarity)** when your filenames are messy and inconsistent, but share common character patterns (e.g. `invoice_jan_final.pdf`, `feb-invoice-v2.pdf`). This uses mathematical string matching (AGNES).
> *   **Use `--ai-groups` (Semantic Embeddings)** when files have completely different names but mean the same thing (e.g. `Q3_Earnings.pdf` and `Financial_Statement.pdf`). This requires **Ollama** to be running locally. It will automatically download the lightweight `nomic-embed-text` model to embed your filenames, group them by pure meaning, and even try to use `llama3` to generate beautiful context-aware folder names!

### Grouping UI (Visual Editor)
If you run `notebooklm-compiler --grouping-ui`, a local web server will spin up and open a Kanban-style interface in your browser. From here you can:
- Drag and drop files between groups
- Create, rename, and delete clusters
- **Live Preview Auto-Grouping:** Click the "Regex", "Smart", or "✨ AI" buttons to instantly re-cluster your files right on the screen. (If you don't like the result, just press `Cmd+Z` to Undo!)
- Keep track of history and restore past configurations using the built-in time-travel sidebar.

#### Option A: Pattern Matching (`--suggest-groups`)
This mode uses simple Regular Expressions to group files by prefix.
```bash
notebooklm-compiler --suggest-groups
```
By default, this groups files by any alphabetical prefix (e.g., `DOC-001.pdf` and `DOC-002.pdf` become group "DOC"). You can explicitly pass your own Regex:
```bash
notebooklm-compiler --suggest-groups "^([A-Za-z0-9]+)_"
```

#### Option B: AI Clustering (`--smart-groups`)
If your files don't have neat, predictable prefixes, you can use the Machine Learning clustering mode. This uses the AGNES (Agglomerative Nesting) algorithm to mathematically group files that have highly similar file names (e.g., matching dates or topic words).
```bash
notebooklm-compiler --smart-groups
```

**Tuning the ML Strictness:**
By default, files must be at least `0.4` (40%) similar to be clustered together. If you find that the algorithm is shattering your files into dozens of tiny 1-2 file groups, your filenames are too diverse. You can loosen the algorithm by lowering the required similarity:
```bash
notebooklm-compiler --smart-groups --similarity 0.2
```
*(Conversely, if it lumps everything into one massive group, raise the similarity to `0.6` or `0.8`)*

#### Understanding the Output
When you run either command, the compiler will output a beautiful ASCII tree report directly in your terminal so you can visually verify why things were grouped together. It will then save the physical map to `groups.json`.

**The `groups.json` Schema:**
The generated file is a simple JSON object where the "Keys" are the names of the final merged PDFs, and the "Values" are arrays of the actual files that belong in them.
```json
{
  "Cluster_1": [
    "Medical_Record_1.pdf",
    "Medical_Record_2.pdf"
  ],
  "Ungrouped": [
    "Random_Receipt.pdf"
  ]
}
```
*Crucial Step: You can manually open and edit `groups.json` in any text editor before compiling to perfect the arrays!*

### 2. Compiling and Compressing
To run the full compiler using your groups file:
```bash
notebooklm-compiler --groups groups.json --compress
```

### 3. Hangs and Corrupt Files (Robust Error Handling)
If your input directory contains fundamentally corrupted PDFs, empty shells, or files that cause underlying compression engines (like Clop or Ghostscript) to infinitely freeze, the compiler will protect itself automatically:
- **Corrupt File Bouncer:** The compiler scans the physical byte size of your input PDFs. If a file is under 1KB (physically impossible for a valid PDF), it immediately throws an error and safely skips it without crashing the run.
- **Aggressive Timeouts:** The compiler enforces a strict timeout (`5` minutes by default, configurable via `--timeout`) per file. If a file causes the compression engine to hang indefinitely, the worker thread will aggressively `SIGKILL` the engine, safely abort the entire compiler run with a `[CRITICAL ERROR]`, and instruct you on what to do.
- **Atomic Writes:** Compressed files are written to randomized temporary names and only renamed to their final path upon 100% successful compression. If you forcibly abort the script (or if a timeout occurs), there will be no corrupted partial files in your cache to break future runs.

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
| `--timeout` | Max minutes to allow compression per file before aborting | `5` |

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
