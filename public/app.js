document.addEventListener('DOMContentLoaded', async () => {
    const ungroupedList = document.getElementById('ungrouped-list');
    const groupsContainer = document.getElementById('groups-container');
    const groupTemplate = document.getElementById('group-template');
    const saveBtn = document.getElementById('save-btn');
    const addGroupBtn = document.getElementById('add-group-btn');
    const fileSelector = document.getElementById('file-selector');
    const deleteFileBtn = document.getElementById('delete-file-btn');
    const undoBtn = document.getElementById('undo-btn');
    
    // Auto Group Elements
    const regexBtn = document.getElementById('regex-group-btn');
    const smartBtn = document.getElementById('smart-group-btn');
    const similarityInput = document.getElementById('similarity-input');
    
    // History Panel elements
    const historyBtn = document.getElementById('history-btn');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const historyPanel = document.getElementById('history-panel');
    const historyList = document.getElementById('history-list');

    const LOCAL_STORAGE_KEY = 'notebooklm_compiler_unsaved_groups';
    let currentLoadedFile = 'groups.json';
    
    // History State
    // Format: [ { label: "Action name", state: "JSON_STRING" }, ... ]
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

    function pushToHistory(actionLabel) {
        if (lastKnownState) {
            historyStack.push({
                label: actionLabel,
                state: JSON.stringify(lastKnownState)
            });
            if (historyStack.length > 50) historyStack.shift();
            undoBtn.disabled = false;
            renderHistoryPanel();
        }
    }
    
    // Save current UI state to localStorage
    function saveToLocal(actionLabel = null) {
        if (actionLabel) pushToHistory(actionLabel);
        
        const currentState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            groups: currentState.groups,
            history: historyStack // Persist history across reloads
        }));
        lastKnownState = currentState;
        if (actionLabel) renderHistoryPanel(); // Re-render for the "Current State" bubble
    }

    function performUndo() {
        if (historyStack.length === 0) return;
        const previousAction = historyStack.pop();
        const previousState = JSON.parse(previousAction.state);
        
        renderBoard(previousState.groups);
        
        // Save to local storage but don't add this action to history
        const currentState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            groups: currentState.groups,
            history: historyStack
        }));
        lastKnownState = currentState;
        
        if (historyStack.length === 0) {
            undoBtn.disabled = true;
        }
        renderHistoryPanel();
    }
    
    function performUndoTo(index) {
        if (index < 0 || index >= historyStack.length) return;
        
        const targetAction = historyStack[index];
        const previousState = JSON.parse(targetAction.state);
        
        // Truncate history stack
        historyStack = historyStack.slice(0, index);
        
        renderBoard(previousState.groups);
        
        const currentState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            groups: currentState.groups,
            history: historyStack
        }));
        lastKnownState = currentState;
        
        if (historyStack.length === 0) {
            undoBtn.disabled = true;
        }
        renderHistoryPanel();
    }

    function renderHistoryPanel() {
        historyList.innerHTML = '';
        
        // The most recent state (Current)
        const currentLi = document.createElement('li');
        currentLi.className = 'history-item current';
        currentLi.innerHTML = `<span>⏺ Current State</span>`;
        historyList.appendChild(currentLi);
        
        // Traverse history backward
        for (let i = historyStack.length - 1; i >= 0; i--) {
            const item = historyStack[i];
            const li = document.createElement('li');
            li.className = 'history-item';
            li.innerHTML = `<span>↩ ${item.label}</span>`;
            li.addEventListener('click', () => performUndoTo(i));
            historyList.appendChild(li);
        }
    }

    // Toggle history sidebar
    historyBtn.addEventListener('click', () => {
        historyPanel.classList.toggle('hidden');
    });
    closeHistoryBtn.addEventListener('click', () => {
        historyPanel.classList.add('hidden');
    });

    // Initialize Sortable on a container
    function makeSortable(element) {
        new Sortable(element, {
            group: 'shared',
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onStart: () => {
                lastKnownState = getCurrentState(); 
            },
            onEnd: (evt) => {
                if (evt.from !== evt.to || evt.oldIndex !== evt.newIndex) {
                    const filename = evt.item.dataset.file;
                    const toGroup = evt.to.closest('.board-column').querySelector('h2, .group-name-input').value || 'Holding Area';
                    updateCounts();
                    saveToLocal(`Moved ${filename} to ${toGroup}`);
                }
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
        
        let oldName = groupName;
        input.addEventListener('focus', () => {
            lastKnownState = getCurrentState();
            oldName = input.value;
        });
        input.addEventListener('change', () => {
            if (input.value !== oldName) {
                saveToLocal(`Renamed "${oldName}" to "${input.value}"`);
            }
        });
        
        files.forEach(file => {
            list.appendChild(createCard(file));
        });

        deleteBtn.addEventListener('click', () => {
            if (confirm(`Are you sure you want to delete "${input.value}"? Any files inside will be moved to the Holding Area.`)) {
                lastKnownState = getCurrentState();
                const cards = Array.from(list.children);
                cards.forEach(card => ungroupedList.appendChild(card));
                col.remove();
                updateCounts();
                saveToLocal(`Deleted group "${input.value}"`);
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
                const parsed = JSON.parse(savedState);
                if (confirm("You have unsaved drag-and-drop changes. Restore them? (Cancel to load from disk)")) {
                    renderBoard(parsed.groups);
                    historyStack = parsed.history || [];
                    undoBtn.disabled = historyStack.length === 0;
                    lastKnownState = getCurrentState();
                    renderHistoryPanel();
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
            renderHistoryPanel();
            
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
        saveToLocal(`Created new group "${newName}"`);
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
            renderHistoryPanel();
            
        } catch (err) {
            console.error(err);
            saveBtn.style.background = 'var(--danger)';
            saveBtn.textContent = "Error Saving";
            saveBtn.disabled = false;
        }
    });

    // Auto Group Logic
    async function runAutoGroup(type) {
        if (!confirm(`Warning: Running this will automatically regroup all files. Your current layout will be overwritten (but you can Undo it). Proceed?`)) {
            return;
        }
        
        lastKnownState = getCurrentState();
        const similarity = similarityInput.value;
        const btn = type === 'smart' ? smartBtn : regexBtn;
        const originalText = btn.textContent;
        
        btn.textContent = "Processing...";
        btn.disabled = true;

        try {
            const res = await fetch('/api/auto-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, similarity })
            });
            const data = await res.json();
            
            pushToHistory(type === 'smart' ? `Smart Grouped (Sim: ${similarity})` : `Regex Grouped`);
            renderBoard(data.groups);
            lastKnownState = getCurrentState();
            
        } catch (err) {
            console.error("Auto Group Failed", err);
            alert("Failed to run auto-grouping.");
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }

    regexBtn.addEventListener('click', () => runAutoGroup('regex'));
    smartBtn.addEventListener('click', () => runAutoGroup('smart'));

    // Initial load
    loadData();
});
