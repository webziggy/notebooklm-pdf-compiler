#!/usr/bin/env node

const { fork } = require('child_process');
const path = require('path');

// Spin up the compiler in a massive 8GB V8 memory sandbox 
// This avoids the "heap out of memory" error on massive PDFs
// and avoids linux compatibility issues with shebang flags.

const child = fork(path.join(__dirname, 'index.js'), process.argv.slice(2), {
    execArgv: ['--max-old-space-size=8192']
});

child.on('exit', (code) => {
    process.exit(code);
});
