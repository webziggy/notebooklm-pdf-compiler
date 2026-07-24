document.addEventListener('DOMContentLoaded', async () => {
    const ungroupedList = document.getElementById('ungrouped-list');
    const groupsContainer = document.getElementById('groups-container');
    const groupTemplate = document.getElementById('group-template');
    const saveBtn = document.getElementById('save-btn');
    const addGroupBtn = document.getElementById('add-group-btn');

    let stateGroups = {};
    
    // Initialize Sortable on a container
    function makeSortable(element) {
        new Sortable(element, {
            group: 'shared',
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: updateCounts
        });
    }

    // Update file counts in column headers
    function updateCounts() {
        const columns = document.querySelectorAll('.board-column');
        columns.forEach(col => {
            const countSpan = col.querySelector('.count');
            const items = col.querySelectorAll('.pdf-card').length;
            countSpan.textContent = items;
        });
    }

    // Create a new PDF card element
    function createCard(filename) {
        const div = document.createElement('div');
        div.className = 'pdf-card';
        div.textContent = '📄 ' + filename;
        div.dataset.file = filename;
        return div;
    }

    // Create a new Group Column
    function createGroupColumn(groupName, files) {
        const clone = groupTemplate.content.cloneNode(true);
        const col = clone.querySelector('.board-column');
        const input = clone.querySelector('.group-name-input');
        const list = clone.querySelector('.sortable-list');
        const deleteBtn = clone.querySelector('.delete-group-btn');

        input.value = groupName;
        
        files.forEach(file => {
            list.appendChild(createCard(file));
        });

        deleteBtn.addEventListener('click', () => {
            if (list.children.length > 0) {
                alert("Please empty the group (drag files to Ungrouped) before deleting.");
                return;
            }
            col.remove();
        });

        makeSortable(list);
        groupsContainer.appendChild(col);
    }

    // Load Data
    try {
        const res = await fetch('/api/data');
        const data = await res.json();
        stateGroups = data.groups;

        // Populate Ungrouped
        const ungroupedFiles = stateGroups['Ungrouped'] || [];
        ungroupedFiles.forEach(file => {
            ungroupedList.appendChild(createCard(file));
        });
        makeSortable(ungroupedList);

        // Populate Groups
        for (const [groupName, files] of Object.entries(stateGroups)) {
            if (groupName !== 'Ungrouped') {
                createGroupColumn(groupName, files);
            }
        }
        
        updateCounts();

    } catch (err) {
        console.error("Failed to load data", err);
        alert("Failed to connect to the local server.");
    }

    // Add empty group
    addGroupBtn.addEventListener('click', () => {
        const newName = "New_Cluster_" + (document.querySelectorAll('.group-col').length + 1);
        createGroupColumn(newName, []);
        updateCounts();
        
        // Scroll to right
        groupsContainer.scrollLeft = groupsContainer.scrollWidth;
    });

    // Save and Compile
    saveBtn.addEventListener('click', async () => {
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;

        const payload = { groups: {} };
        
        // Grab Ungrouped
        payload.groups['Ungrouped'] = Array.from(ungroupedList.children).map(c => c.dataset.file);

        // Grab all group columns
        const groupCols = document.querySelectorAll('.group-col');
        groupCols.forEach(col => {
            const name = col.querySelector('.group-name-input').value.trim() || 'Unnamed_Group';
            const files = Array.from(col.querySelector('.sortable-list').children).map(c => c.dataset.file);
            payload.groups[name] = files;
        });

        try {
            await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            saveBtn.style.background = 'var(--success)';
            saveBtn.textContent = "Saved! Check Terminal.";
        } catch (err) {
            console.error(err);
            saveBtn.style.background = 'var(--danger)';
            saveBtn.textContent = "Error Saving";
        }
    });
});
