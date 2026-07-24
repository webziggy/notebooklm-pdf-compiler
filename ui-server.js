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
        let groups = {};
        if (fs.existsSync(groupsOutput)) {
            groups = JSON.parse(fs.readFileSync(groupsOutput, 'utf8'));
        }

        const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf'));
        const groupedFiles = new Set(Object.values(groups).flat());
        
        const ungrouped = files.filter(f => !groupedFiles.has(f));
        groups['Ungrouped'] = ungrouped;

        res.json({ groups });
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
        
        fs.writeFileSync(groupsOutput, JSON.stringify(finalGroups, null, 2));
        console.log(`\n[UI] Successfully saved to ${groupsOutput}!`);
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
