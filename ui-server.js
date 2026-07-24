const express = require('express');
const fs = require('fs');
const path = require('path');
const open = require('open');

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
        await open(`http://localhost:${port}`);
    });
}

module.exports = { startUI };
