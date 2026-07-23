# NotebookLM PDF Compiler

A standalone CLI tool that stitches massive directories of PDFs together into beautifully optimized "Volumes" that perfectly comply with Google NotebookLM's strict upload limits.

NotebookLM has two incredibly strict constraints that make uploading bulk documents difficult:
1. **Maximum 500,000 words** per source.
2. **Maximum 200MB** file size per source.

If you are uploading massive datasets, archives, or textbooks, manually chunking PDFs to fit these constraints is impossible. This tool does it for you by mathematically tracking the word count and byte size of your PDFs in memory, and automatically slicing them into `Volume_1.pdf`, `Volume_2.pdf`, etc., the exact moment they approach the limits.

## Installation

```bash
git clone https://github.com/webziggy/notebooklm-pdf-compiler.git
cd notebooklm-pdf-compiler
npm install
```

## Usage

1. Place all of your raw PDFs into an `input/` folder.
2. Run the compiler:

```bash
# Because merging massive PDFs is incredibly RAM intensive, we highly recommend passing max-old-space-size to Node!
npm start
```
Or directly via node:
```bash
node --max-old-space-size=8192 index.js --input ./my_pdfs --output ./ready_for_notebook
```

### Dry Run
Want to see exactly how your PDFs will be chunked without actually waiting for them to stitch together? Use the `--dry-run` flag:
```bash
node index.js --dry-run
```

### CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--input` | Directory containing your source PDFs | `./input` |
| `--output` | Directory where the stitched volumes will be saved | `./output` |
| `--dry-run` | Simulates the chunking math without writing actual PDFs | `false` |
| `--max-words` | The maximum word count per volume | `450000` (Leaves 50k buffer) |
| `--max-mb` | The maximum physical file size per volume | `180` (Leaves 20MB buffer) |

## Disclaimer
This project is open-source and not affiliated with Google or NotebookLM.
