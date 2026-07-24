document.addEventListener('DOMContentLoaded', async () => {
    const ungroupedList = document.getElementById('ungrouped-list');
    const groupsContainer = document.getElementById('groups-container');
    const groupTemplate = document.getElementById('group-template');
    const saveBtn = document.getElementById('save-btn');
    const addGroupBtn = document.getElementById('add-group-btn');
    const fileSelector = document.getElementById('file-selector');
    const deleteFileBtn = document.getElementById('delete-file-btn');
    const groupHoldingBtn = document.getElementById('group-holding-btn');
    
    // Auto Group Elements
    const regexBtn = document.getElementById('regex-group-btn');
    const regexInput = document.getElementById('regex-input');
    const smartBtn = document.getElementById('smart-group-btn');
    const similarityInput = document.getElementById('similarity-input');
    const aiBtn = document.getElementById('ai-group-btn');
    
    // History Panel elements
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const historyBtn = document.getElementById('history-btn');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const historyPanel = document.getElementById('history-panel');
    const historyList = document.getElementById('history-list');

    const LOCAL_STORAGE_KEY = 'notebooklm_compiler_unsaved_groups';
    let currentLoadedFile = 'groups.json';
    
    // History State
    let historyStack = [];
    let redoStack = [];
    let lastKnownState = null;

    function getCurrentState() {
        const payload = { groups: {} };
        payload.groups['Holding Area'] = Array.from(ungroupedList.children).map(c => c.dataset.file);
        
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
            
            // Clear redo stack on any new action
            redoStack = [];
            redoBtn.disabled = true;
            
            renderHistoryPanel();
        }
    }
    
    // Save current UI state to localStorage
    function saveToLocal(actionLabel = null) {
        if (actionLabel) pushToHistory(actionLabel);
        
        const currentState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            groups: currentState.groups,
            history: historyStack,
            redo: redoStack
        }));
        lastKnownState = currentState;
        if (actionLabel) renderHistoryPanel();
    }

    function performUndo() {
        if (historyStack.length === 0) return;
        
        // Push current state to Redo stack
        const currentState = getCurrentState();
        redoStack.push({
            label: "Redo", // We could map the exact action name here if we want, but 'Redo' is fine
            state: JSON.stringify(currentState)
        });
        
        const previousAction = historyStack.pop();
        const previousState = JSON.parse(previousAction.state);
        
        renderBoard(previousState.groups);
        
        // Save to local storage but don't add to history
        const newState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            groups: newState.groups,
            history: historyStack,
            redo: redoStack
        }));
        lastKnownState = newState;
        
        undoBtn.disabled = historyStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
        renderHistoryPanel();
    }

    function performRedo() {
        if (redoStack.length === 0) return;
        
        // Push current state to History stack before redoing
        const currentState = getCurrentState();
        historyStack.push({
            label: "Redo action",
            state: JSON.stringify(currentState)
        });
        
        const nextAction = redoStack.pop();
        const nextState = JSON.parse(nextAction.state);
        
        renderBoard(nextState.groups);
        
        const newState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            groups: newState.groups,
            history: historyStack,
            redo: redoStack
        }));
        lastKnownState = newState;
        
        undoBtn.disabled = historyStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
        renderHistoryPanel();
    }
    
    function performUndoTo(index) {
        if (index < 0 || index >= historyStack.length) return;
        
        const currentState = getCurrentState();
        redoStack.push({
            label: "Redo to branch",
            state: JSON.stringify(currentState)
        });
        
        const targetAction = historyStack[index];
        const previousState = JSON.parse(targetAction.state);
        
        historyStack = historyStack.slice(0, index);
        
        renderBoard(previousState.groups);
        
        const newState = getCurrentState();
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
            groups: newState.groups,
            history: historyStack,
            redo: redoStack
        }));
        lastKnownState = newState;
        
        undoBtn.disabled = historyStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
        renderHistoryPanel();
    }

    function renderHistoryPanel() {
        historyList.innerHTML = '';
        
        const currentLi = document.createElement('li');
        currentLi.className = 'history-item current';
        currentLi.innerHTML = `<span>⏺ Current State</span>`;
        historyList.appendChild(currentLi);
        
        for (let i = historyStack.length - 1; i >= 0; i--) {
            const item = historyStack[i];
            const li = document.createElement('li');
            li.className = 'history-item';
            li.innerHTML = `<span>↩ ${item.label}</span>`;
            li.addEventListener('click', () => performUndoTo(i));
            historyList.appendChild(li);
        }
    }

    historyBtn.addEventListener('click', () => {
        historyPanel.classList.toggle('hidden');
    });
    closeHistoryBtn.addEventListener('click', () => {
        historyPanel.classList.add('hidden');
    });

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

    function updateCounts() {
        const columns = document.querySelectorAll('.board-column');
        let totalFiles = 0;
        let totalGroups = 0;
        
        columns.forEach(col => {
            const countSpan = col.querySelector('.count');
            const items = col.querySelectorAll('.pdf-card').length;
            countSpan.textContent = items;
            
            // Do not count the Holding Area as a "Group" for the stats
            if (col.id !== 'ungrouped-container') {
                totalGroups++;
                totalFiles += items;
            }
        });
        
        const groupsVal = document.getElementById('stat-groups-val');
        const filesVal = document.getElementById('stat-files-val');
        const warningBadge = document.getElementById('stat-warning');
        
        if (groupsVal) groupsVal.textContent = totalGroups;
        if (filesVal) filesVal.textContent = totalFiles;
        
        if (warningBadge) {
            if (totalGroups > 50) {
                warningBadge.classList.remove('hidden');
                groupsVal.style.color = '#fca5a5';
            } else {
                warningBadge.classList.add('hidden');
                groupsVal.style.color = 'var(--text-primary)';
            }
        }
        
        if (groupHoldingBtn) {
            const ungroupedItems = document.querySelectorAll('#ungrouped-list .pdf-card').length;
            groupHoldingBtn.disabled = ungroupedItems === 0;
        }
    }

    function createCard(filename) {
        const div = document.createElement('div');
        div.className = 'pdf-card';
        div.textContent = '📄 ' + filename;
        div.dataset.file = filename;
        return div;
    }

    function createGroupColumn(groupName, files, prepend = false) {
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
        if (prepend) {
            groupsContainer.prepend(col);
        } else {
            groupsContainer.appendChild(col);
        }
    }

    function renderBoard(groups) {
        ungroupedList.innerHTML = '';
        groupsContainer.innerHTML = '';
        
        // Ensure we gracefully handle "Ungrouped" legacy naming and new "Holding Area"
        const ungroupedFiles = groups['Holding Area'] || groups['Ungrouped'] || [];
        ungroupedFiles.forEach(file => {
            ungroupedList.appendChild(createCard(file));
        });
        makeSortable(ungroupedList);

        for (const [groupName, files] of Object.entries(groups)) {
            if (groupName !== 'Holding Area' && groupName !== 'Ungrouped') {
                createGroupColumn(groupName, files);
            }
        }
        updateCounts();
    }

    async function loadData(filename = '') {
        try {
            const res = await fetch(`/api/data${filename ? '?file=' + filename : ''}`);
            const data = await res.json();
            
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

            const savedState = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedState && filename === '') {
                const parsed = JSON.parse(savedState);
                if (confirm("You have unsaved drag-and-drop changes. Restore them? (Cancel to load from disk)")) {
                    renderBoard(parsed.groups);
                    historyStack = parsed.history || [];
                    redoStack = parsed.redo || [];
                    undoBtn.disabled = historyStack.length === 0;
                    redoBtn.disabled = redoStack.length === 0;
                    lastKnownState = getCurrentState();
                    renderHistoryPanel();
                    return;
                } else {
                    localStorage.removeItem(LOCAL_STORAGE_KEY);
                }
            }
            
            renderBoard(data.groups);
            lastKnownState = getCurrentState();
            
            historyStack = [];
            redoStack = [];
            undoBtn.disabled = true;
            redoBtn.disabled = true;
            renderHistoryPanel();
            
        } catch (err) {
            console.error("Failed to load data", err);
            alert("Failed to connect to the local server.");
        }
    }

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
            loadData(); 
        }
    });

    undoBtn.addEventListener('click', performUndo);
    redoBtn.addEventListener('click', performRedo);

    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                performRedo();
            } else {
                performUndo();
            }
        }
    });

    addGroupBtn.addEventListener('click', () => {
        lastKnownState = getCurrentState();
        const newName = "New_Cluster_" + (document.querySelectorAll('.group-col').length + 1);
        createGroupColumn(newName, [], true);
        updateCounts();
        saveToLocal(`Created new group "${newName}"`);
        groupsContainer.scrollLeft = 0;
    });
    
    groupHoldingBtn.addEventListener('click', () => {
        lastKnownState = getCurrentState();
        const newName = "New_Cluster_" + (document.querySelectorAll('.group-col').length + 1);
        const cards = Array.from(ungroupedList.children);
        
        // Pass true to prepend the new column
        createGroupColumn(newName, [], true);
        
        // The new column is now the FIRST child in groupsContainer
        const newColList = groupsContainer.firstChild.querySelector('.sortable-list');
        cards.forEach(card => newColList.appendChild(card));
        
        updateCounts();
        saveToLocal(`Grouped Holding Area into "${newName}"`);
        groupsContainer.scrollLeft = 0;
    });

    // AI Modal Elements
    const aiModal = document.getElementById('ai-modal');
    const closeAiModal = document.getElementById('close-ai-modal');
    const cancelAiBtn = document.getElementById('cancel-ai-btn');
    const startAiBtn = document.getElementById('start-ai-btn');
    const aiModelInput = document.getElementById('ai-model-input');
    const aiContextInput = document.getElementById('ai-context-input');
    const aiStatusPanel = document.getElementById('ai-status-panel');
    const aiStatusText = document.getElementById('ai-status-text');

    function closeAiModalFunc() {
        aiModal.classList.add('hidden');
        aiStatusPanel.classList.add('hidden');
    }

    if (closeAiModal) closeAiModal.addEventListener('click', closeAiModalFunc);
    if (cancelAiBtn) cancelAiBtn.addEventListener('click', closeAiModalFunc);

    if (startAiBtn) {
        startAiBtn.addEventListener('click', () => {
            const simTarget = parseFloat(document.getElementById('similarity-input').value) || 0.5;
            const textModel = aiModelInput.value.trim() || 'llama3';
            const context = aiContextInput.value.trim();
            
            aiStatusPanel.classList.remove('hidden');
            aiStatusText.textContent = "Connecting to Ollama...";
            startAiBtn.disabled = true;
            cancelAiBtn.disabled = true;

            let sseUrl = `/api/ai-group-stream?similarity=${simTarget}&model=${encodeURIComponent(textModel)}`;
            if (context) {
                sseUrl += `&context=${encodeURIComponent(context)}`;
            }
            const es = new EventSource(sseUrl);
            
            es.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'progress') {
                    aiStatusText.textContent = data.message;
                } else if (data.type === 'done') {
                    es.close();
                    groups = data.groups;
                    renderBoard(groups);
                    updateCounts();
                    saveToLocal("Smart Grouped via Local AI");
                    closeAiModalFunc();
                    startAiBtn.disabled = false;
                    cancelAiBtn.disabled = false;
                } else if (data.type === 'error') {
                    es.close();
                    aiStatusText.textContent = "Error: " + data.error;
                    aiStatusText.style.color = 'var(--danger)';
                    startAiBtn.disabled = false;
                    cancelAiBtn.disabled = false;
                }
            };
            
            es.onerror = (err) => {
                es.close();
                aiStatusText.textContent = "Connection lost or failed.";
                aiStatusText.style.color = 'var(--danger)';
                startAiBtn.disabled = false;
                cancelAiBtn.disabled = false;
            };
        });
    }

    // Auto Group Logic
    async function runAutoGroup(type) {
        if (!confirm(`Warning: Running this will automatically regroup all files. Your current layout will be overwritten (but you can Undo it). Proceed?`)) {
            return;
        }
        
        lastKnownState = getCurrentState();
        
        if (type === 'ai') {
            aiModal.classList.remove('hidden');
            return;
        }

        const btn = document.getElementById(type + '-group-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Working...';
        btn.disabled = true;

        try {
            const reqBody = { type };
            if (type === 'smart') reqBody.similarity = parseFloat(document.getElementById('similarity-input').value) || 0.4;
            if (type === 'regex') reqBody.regex = document.getElementById('regex-input').value || '^([A-Za-z]+)-';
            
            const res = await fetch('/api/auto-group', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody)
            });
            const data = await res.json();
            
            if (data.error) throw new Error(data.error);
            
            groups = data.groups;
            renderBoard(groups);
            updateCounts();
            
            const typeName = type === 'smart' ? 'ML Smart Clustering' : 'Regex';
            saveToLocal(`Auto-Grouped via ${typeName}`);
            
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
    aiBtn.addEventListener('click', () => runAutoGroup('ai'));

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
            redoStack = [];
            undoBtn.disabled = true;
            redoBtn.disabled = true;
            renderHistoryPanel();
            
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
