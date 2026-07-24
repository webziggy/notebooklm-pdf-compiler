document.addEventListener('DOMContentLoaded', async () => {
    const ungroupedList = document.getElementById('ungrouped-list');
    const groupsContainer = document.getElementById('groups-container');
    const groupTemplate = document.getElementById('group-template');
    const saveBtn = document.getElementById('save-btn');
    const addGroupBtn = document.getElementById('add-group-btn');
    const fileSelector = document.getElementById('file-selector');
    const deleteFileBtn = document.getElementById('delete-file-btn');
    const undoBtn = document.getElementById('undo-btn');

    const LOCAL_STORAGE_KEY = 'notebooklm_compiler_unsaved_groups';
    let currentLoadedFile = 'groups.json';
    
    // History State
    let historyStack = [];
    let lastKnownState = null;

    function getCurrentState() {
        const payload = { groups: {} };
        payload.groups['Ungrouped'] = Array.from(ungroupedList.children).map(c => c.dataset.file);
        
        const groupCols = document.querySelectorAll('.group-col');
        groupCols.forEach(col => {
            const name = col.querySelector('.group-name-input').value.trim() || 'Unnamed_Group';
            const files = Array.from(col.querySelector('.sortable-list').children).map(c => c.dataset.file);
            payload.groups[name] = files;
        });
        return payload;
    }

    function pushToHistory() {
        if (lastKnownState) {
            historyStack.push(JSON.stringify(lastKnownState));
            if (historyStack.length > 50) historyStack.shift();
            undoBtn.disabled = false;
        }
    }
    
    // Save current UI state to localStorage
    function saveToLocal(skipHistory = false) {
        if (!skipHistory) pushToHistory();
        
        const currentState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(currentState));
        lastKnownState = currentState;
    }

    function performUndo() {
        if (historyStack.length === 0) return;
        const previousStateStr = historyStack.pop();
        const previousState = JSON.parse(previousStateStr);
        
        renderBoard(previousState.groups);
        
        // Save to local storage but don't add this action to history
        const currentState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(currentState));
        lastKnownState = currentState;
        
        if (historyStack.length === 0) {
            undoBtn.disabled = true;
        }
    }

    // Initialize Sortable on a container
    function makeSortable(element) {
        new Sortable(element, {
            group: 'shared',
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onStart: () => {
                // We ensure lastKnownState is pristine before drag starts
                lastKnownState = getCurrentState(); 
            },
            onEnd: () => {
                updateCounts();
                saveToLocal();
            }
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
        
        // Track focus to save history right before renaming
        input.addEventListener('focus', () => {
            lastKnownState = getCurrentState();
        });
        input.addEventListener('change', () => saveToLocal());
        
        files.forEach(file => {
            list.appendChild(createCard(file));
        });

        // Automatically dump files to Ungrouped when deleting a column
        deleteBtn.addEventListener('click', () => {
            if (confirm(`Are you sure you want to delete "${input.value}"? Any files inside will be moved to the Ungrouped Bucket.`)) {
                lastKnownState = getCurrentState();
                const cards = Array.from(list.children);
                cards.forEach(card => ungroupedList.appendChild(card));
                col.remove();
                updateCounts();
                saveToLocal();
            }
        });

        makeSortable(list);
        groupsContainer.appendChild(col);
    }

    // Render the board from a groups object
    function renderBoard(groups) {
        ungroupedList.innerHTML = '';
        groupsContainer.innerHTML = '';
        
        const ungroupedFiles = groups['Ungrouped'] || [];
        ungroupedFiles.forEach(file => {
            ungroupedList.appendChild(createCard(file));
        });
        makeSortable(ungroupedList);

        for (const [groupName, files] of Object.entries(groups)) {
            if (groupName !== 'Ungrouped') {
                createGroupColumn(groupName, files);
            }
        }
        updateCounts();
    }

    // Load Data
    async function loadData(filename = '') {
        try {
            const res = await fetch(`/api/data${filename ? '?file=' + filename : ''}`);
            const data = await res.json();
            
            // Populate File Selector
            fileSelector.innerHTML = '';
            data.groupFiles.forEach(file => {
                const opt = document.createElement('option');
                opt.value = file;
                opt.textContent = file;
                if (file === data.currentFile) opt.selected = true;
                fileSelector.appendChild(opt);
            });
            
            currentLoadedFile = data.currentFile;
            
            if (currentLoadedFile !== 'groups.json') {
                deleteFileBtn.classList.remove('hidden');
            } else {
                deleteFileBtn.classList.add('hidden');
            }

            // Check Local Storage
            const savedState = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedState && filename === '') {
                if (confirm("You have unsaved drag-and-drop changes. Restore them? (Cancel to load from disk)")) {
                    renderBoard(JSON.parse(savedState).groups);
                    lastKnownState = getCurrentState();
                    return;
                } else {
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                }
            }
            
            renderBoard(data.groups);
            lastKnownState = getCurrentState();
            
            // Reset history when loading a new file
            historyStack = [];
            undoBtn.disabled = true;
            
        } catch (err) {
            console.error("Failed to load data", err);
            alert("Failed to connect to the local server.");
        }
    }

    // Event Listeners for Header
    fileSelector.addEventListener('change', (e) => {
        loadData(e.target.value);
    });

    deleteFileBtn.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to delete ${currentLoadedFile}?`)) {
            await fetch('/api/delete-file', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: currentLoadedFile })
            });
            loadData(); // reload default
        }
    });

    undoBtn.addEventListener('click', performUndo);

    // Keyboard shortcut for Undo (Cmd+Z or Ctrl+Z)
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            performUndo();
        }
    });

    addGroupBtn.addEventListener('click', () => {
        lastKnownState = getCurrentState();
        const newName = "New_Cluster_" + (document.querySelectorAll('.group-col').length + 1);
        createGroupColumn(newName, []);
        updateCounts();
        saveToLocal();
        groupsContainer.scrollLeft = groupsContainer.scrollWidth;
    });

    saveBtn.addEventListener('click', async () => {
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;

        const payload = getCurrentState();

        try {
            await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            localStorage.removeItem(LOCAL_STORAGE_KEY);
            saveBtn.style.background = 'var(--success)';
            saveBtn.textContent = "Saved! Check Terminal.";
            
            historyStack = [];
            undoBtn.disabled = true;
            
        } catch (err) {
            console.error(err);
            saveBtn.style.background = 'var(--danger)';
            saveBtn.textContent = "Error Saving";
            saveBtn.disabled = false;
        }
    });

    // Initial load
    loadData();
});
