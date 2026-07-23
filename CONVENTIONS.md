# NotebookLM PDF Compiler Conventions

This document contains architectural decisions and hard-won lessons learned regarding handling massive PDFs in Node.js and strictly adhering to Google NotebookLM limits. If you are developing or maintaining this project, strictly follow these rules:

## 1. NotebookLM Strict Limits
Google NotebookLM instantly rejects documents that exceed its limits. A robust compiler must defensively track BOTH limits simultaneously:
*   **Word Count Limit:** 500,000 words maximum. (Default chunking should be `450,000` to leave a 10% safety buffer).
*   **File Size Limit:** 200 MB maximum. (Default chunking should be `180MB` to leave a 10% safety buffer).

## 2. Preventing V8 Memory Crashes (`pdf-lib`)
Merging massive, high-DPI PDFs (100MB+) using `pdf-lib` is incredibly RAM-intensive and will quickly crash the V8 V8 JavaScript heap (`heap out of memory`).
*   **Requirement:** Always ensure the CLI instructs the user to run Node with the `--max-old-space-size=8192` (8GB) flag. We currently enforce this via `npm start`. If you build a global binary, you must spawn a child process to inject this memory allocation.

## 3. Preventing macOS UI Freezes
Heavy I/O file reading combined with `pdf-parse` blocking the event loop can pin a MacBook CPU to 100% and completely freeze the user's mouse/UI.
*   **Requirement:** Always lower the Node process priority at the top of the script so the OS prioritizes UI and background services:
    ```javascript
    const os = require('os');
    try { os.setPriority(10); } catch (e) {}
    ```

## 4. Bulletproof PDF Parsing
Not all PDFs are perfectly formed. `pdf-parse` will occasionally throw critical exceptions when scanning corrupted or non-standard PDFs.
*   **Requirement:** Never allow a `pdf-parse` exception to crash the entire compiler loop. Always catch it and provide a safe integer fallback for the word count (e.g., `10000` words per failed file) so the volume stitching can continue unharmed.

## 5. Bypassing macOS "Zombie" Locks (EPERM)
When manipulating massive files inside macOS `Documents/` or `Desktop/` folders, iCloud's `bird` daemon can occasionally place "Zombie" locks on files, resulting in bizarre `EPERM: uv_cwd` or `Operation not permitted` errors.
*   **Troubleshooting Rule:** If you encounter mysterious `EPERM` errors while writing or merging PDFs, the fix is to completely restart the Terminal process, or temporarily move the `input/` and `output/` directories to a non-iCloud synchronized directory (like `~/Downloads` or `/tmp`).

## 6. Bypassing macOS Background Throttling (App Nap)
Because compiling massive PDFs is a long-running background task, macOS may aggressively throttle the Node process to save battery (App Nap) if the display sleeps or the terminal window is hidden.
*   **Requirement:** If you are running massive compilation jobs that take hours, recommend running the compiler with `caffeinate` to prevent the OS from putting the process to sleep:
    ```bash
    caffeinate node --max-old-space-size=8192 index.js
    ```
