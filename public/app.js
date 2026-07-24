document.addEventListener('DOMContentLoaded', async () => {
    const ungroupedList = document.getElementById('ungrouped-list');
    const groupsContainer = document.getElementById('groups-container');
    const groupTemplate = document.getElementById('group-template');
    const saveBtn = document.getElementById('save-btn');
    const addGroupBtn = document.getElementById('add-group-btn');
    const overviewBtn = document.getElementById('overview-btn');
    const fileSelector = document.getElementById('file-selector');
    const deleteFileBtn = document.getElementById('delete-file-btn');
    const groupHoldingBtn = document.getElementById('group-holding-btn');
    
    // Auto Group Elements
    const aiRenameBtn = document.getElementById('ai-rename-btn');
    const aiRenameModal = document.getElementById('ai-rename-modal');
    const closeAiRenameModal = document.getElementById('close-ai-rename-modal');
    const cancelAiRenameBtn = document.getElementById('cancel-ai-rename-btn');
    const startAiRenameBtn = document.getElementById('start-ai-rename-btn');
    const aiRenameStatusPanel = document.getElementById('ai-rename-status-panel');
    const aiRenameStatusText = document.getElementById('ai-rename-status-text');
    const aiRenameModelInput = document.getElementById('ai-rename-model');
    const aiRenameContextInput = document.getElementById('ai-rename-context');

    let activeRenameController = null;

    if (aiRenameBtn) {
        aiRenameBtn.addEventListener('click', () => {
            aiRenameModal.classList.remove('hidden');
        });
        
        [closeAiRenameModal, cancelAiRenameBtn].forEach(btn => {
            btn.addEventListener('click', () => {
                aiRenameModal.classList.add('hidden');
                aiRenameStatusPanel.classList.add('hidden');
                startAiRenameBtn.disabled = false;
                if (activeRenameController) {
                    activeRenameController.abort();
                    activeRenameController = null;
                }
            });
        });
        
        startAiRenameBtn.addEventListener('click', async () => {
            const textModel = aiRenameModelInput.value.trim() || 'llama3';
            const context = aiRenameContextInput.value.trim();
            
            aiRenameStatusPanel.classList.remove('hidden');
            aiRenameStatusText.textContent = "Connecting to server...";
            startAiRenameBtn.disabled = true;
            
            try {
                const currentState = getCurrentState();
                activeRenameController = new AbortController();
                
                const res = await fetch('/api/ai-rename-stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ groups: currentState.groups, model: textModel, context: context }),
                    signal: activeRenameController.signal
                });
                
                if (!res.ok) throw new Error("Server rejected request");
                
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunkStr = decoder.decode(value);
                    const lines = chunkStr.split('\n').filter(l => l.trim() !== '');
                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            if (data.type === 'progress') {
                                aiRenameStatusText.textContent = data.message;
                            } else if (data.type === 'error') {
                                aiRenameStatusText.textContent = "Error: " + data.error;
                                aiRenameStatusText.style.color = 'var(--danger)';
                                startAiRenameBtn.disabled = false;
                                return;
                            } else if (data.type === 'done') {
                                renderBoard(data.groups);
                                updateCounts();
                                saveToLocal("AI Renamed Clusters");
                                
                                aiRenameModal.classList.add('hidden');
                                aiRenameStatusPanel.classList.add('hidden');
                                startAiRenameBtn.disabled = false;
                                activeRenameController = null;
                                showToast("Clusters successfully renamed by AI!");
                            }
                        } catch(e) { }
                    }
                }
            } catch (err) {
                if (err.name === 'AbortError') {
                    aiRenameStatusText.textContent = "Operation cancelled.";
                } else {
                    aiRenameStatusText.textContent = "Error: " + err.message;
                    aiRenameStatusText.style.color = 'var(--danger)';
                }
                startAiRenameBtn.disabled = false;
                activeRenameController = null;
            }
        });
    }

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
            const name = col.querySelector('.group-name-input').textContent.trim() || 'Unnamed_Group';
            const files = Array.from(col.querySelector('.sortable-list').children).map(c => c.dataset.file);
            payload.groups[name] = files;
        });
        return payload;
    }

    function showToast(message) {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 9999;';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = 'background: rgba(59,130,246,0.9); color: white; padding: 0.75rem 1.5rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); opacity: 0; transition: opacity 0.3s, transform 0.3s; transform: translateY(20px); font-family: "DM Sans", sans-serif; font-size: 0.9rem;';
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 10);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
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
            showToast(actionLabel);
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
        showToast("Undid action: " + previousAction.label);
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
        showToast("Redid action: " + nextAction.label);
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
            multiDrag: true,
            selectedClass: 'selected-card',
            fallbackTolerance: 3,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onStart: () => {
                lastKnownState = getCurrentState(); 
            },
            onEnd: (evt) => {
                // If it's a multi-drag event, evt.items will contain all dragged items
                if (evt.from !== evt.to || evt.oldIndex !== evt.newIndex) {
                    const toGroup = evt.to.closest('.board-column').querySelector('.group-name-input') 
                                    ? evt.to.closest('.board-column').querySelector('.group-name-input').textContent.trim() 
                                    : 'Holding Area';
                    
                    if (evt.items && evt.items.length > 0) {
                        updateCounts();
                        saveToLocal(`Moved ${evt.items.length} files to ${toGroup}`);
                    } else {
                        const filename = evt.item.dataset.file;
                        updateCounts();
                        saveToLocal(`Moved ${filename} to ${toGroup}`);
                    }
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
        const collapseBtn = clone.querySelector('.collapse-group-btn');
        const colorPicker = clone.querySelector('.group-color-picker');

        input.textContent = groupName;
        
        let oldName = groupName;
        
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => {
                col.classList.toggle('collapsed');
                collapseBtn.textContent = col.classList.contains('collapsed') ? '+' : '–';
            });
        }
        
        if (colorPicker) {
            const savedColors = JSON.parse(localStorage.getItem('notebooklm_compiler_colors') || '{}');
            if (savedColors[groupName]) {
                colorPicker.value = savedColors[groupName];
                col.style.borderColor = savedColors[groupName];
                col.style.boxShadow = savedColors[groupName] !== 'transparent' ? `0 0 10px ${savedColors[groupName]}40` : 'none';
            }
            colorPicker.addEventListener('change', (e) => {
                const val = e.target.value;
                col.style.borderColor = val;
                col.style.boxShadow = val !== 'transparent' ? `0 0 10px ${val}40` : 'none';
                
                const colors = JSON.parse(localStorage.getItem('notebooklm_compiler_colors') || '{}');
                colors[input.textContent.trim()] = val;
                localStorage.setItem('notebooklm_compiler_colors', JSON.stringify(colors));
                saveToLocal(`Changed color for "${input.textContent.trim()}"`);
            });
        }
        input.addEventListener('focus', () => {
            lastKnownState = getCurrentState();
            oldName = input.textContent.trim();
        });
        
        // Use blur or input event since contenteditable doesn't fire change
        input.addEventListener('blur', () => {
            const newName = input.textContent.trim();
            if (newName !== oldName) {
                saveToLocal(`Renamed "${oldName}" to "${newName}"`);
            }
        });
        
        files.forEach(file => {
            list.appendChild(createCard(file));
        });

        deleteBtn.addEventListener('click', () => {
            const currentName = input.textContent.trim();
            if (confirm(`Are you sure you want to delete "${currentName}"? Any files inside will be moved to the Holding Area.`)) {
                lastKnownState = getCurrentState();
                const cards = Array.from(list.children);
                cards.forEach(card => ungroupedList.appendChild(card));
                col.remove();
                updateCounts();
                saveToLocal(`Deleted group "${currentName}"`);
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

    // Filtering Logic
    let activeColors = ['all'];
    let currentSearchTerm = '';

    function applyFilters() {
        const allCols = document.querySelectorAll('.board-column');
        const groupsContainer = document.getElementById('groups-container');
        let visibleCount = 0;
        let totalCount = 0;
        
        allCols.forEach(col => {
            if (col.id === 'ungrouped-container') return;
            totalCount++;
            
            // 1. Text Filter
            const visibleCards = Array.from(col.querySelectorAll('.pdf-card')).filter(c => {
                if (currentSearchTerm === '') {
                    c.style.display = 'flex';
                    return true;
                }
                const matches = c.dataset.file.toLowerCase().includes(currentSearchTerm);
                c.style.display = matches ? 'flex' : 'none';
                return matches;
            });
            
            const matchesText = currentSearchTerm === '' || visibleCards.length > 0;
            
            // 2. Color Filter
            let matchesColor = true;
            if (!activeColors.includes('all')) {
                const select = col.querySelector('.group-color-picker');
                const colColor = select ? select.value : 'transparent';
                matchesColor = activeColors.includes(colColor);
            }
            
            if (matchesText && matchesColor) {
                col.style.display = 'flex';
                visibleCount++;
            } else {
                col.style.display = 'none';
            }
        });
        
        let banner = document.getElementById('color-filter-banner');
        if (!activeColors.includes('all') && groupsContainer) {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'color-filter-banner';
                banner.style.cssText = 'background: rgba(239, 68, 68, 0.15); border: 1px dashed var(--danger); color: #fca5a5; padding: 0.5rem; text-align: center; border-radius: 6px; margin-bottom: 1rem; font-weight: 600; width: 100%; grid-column: 1 / -1;';
                groupsContainer.prepend(banner);
            }
            banner.textContent = `⚠️ Color Filter Active: Showing ${visibleCount} of ${totalCount} clusters`;
            banner.style.display = 'block';
        } else {
            if (banner) banner.style.display = 'none';
        }
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value.toLowerCase().trim();
            applyFilters();
        });
    }

    const colorFilterBtns = document.querySelectorAll('.color-filter-btn');
    colorFilterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const color = e.target.dataset.color || 'all';
            if (color === 'all') {
                activeColors = ['all'];
                colorFilterBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            } else {
                activeColors = activeColors.filter(c => c !== 'all');
                const allBtn = Array.from(colorFilterBtns).find(b => b.dataset.color === 'all');
                if (allBtn) allBtn.classList.remove('active');
                
                if (activeColors.includes(color)) {
                    activeColors = activeColors.filter(c => c !== color);
                    e.target.classList.remove('active');
                } else {
                    activeColors.push(color);
                    e.target.classList.add('active');
                }
                
                if (activeColors.length === 0) {
                    activeColors = ['all'];
                    if (allBtn) allBtn.classList.add('active');
                }
            }
            applyFilters();
        });
    });

    // Sort Logic
    const sortSelect = document.getElementById('sort-clusters');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val) return;
            
            const cols = Array.from(groupsContainer.querySelectorAll('.group-col'));
            cols.sort((a, b) => {
                const countA = parseInt(a.querySelector('.count').textContent) || 0;
                const countB = parseInt(b.querySelector('.count').textContent) || 0;
                const nameA = a.querySelector('.group-name-input').textContent.trim().toLowerCase();
                const nameB = b.querySelector('.group-name-input').textContent.trim().toLowerCase();
                
                if (val === 'count-desc') return countB - countA;
                if (val === 'count-asc') return countA - countB;
                if (val === 'name-asc') return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                if (val === 'name-desc') return nameB.localeCompare(nameA, undefined, { numeric: true, sensitivity: 'base' });
                return 0;
            });
            
            cols.forEach(col => groupsContainer.appendChild(col));
            e.target.value = '';
            
            const labels = {
                'count-desc': 'Largest First',
                'count-asc': 'Smallest First',
                'name-asc': 'Name A-Z',
                'name-desc': 'Name Z-A'
            };
            saveToLocal(`Sorted clusters by ${labels[val]}`);
        });
    }

    // Overview Modal
    const overviewModal = document.getElementById('overview-modal');
    const closeOverviewModal = document.getElementById('close-overview-modal');
    const bubbleContainer = document.getElementById('bubble-container');
    
    // Zoom Controls
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const zoomResetBtn = document.getElementById('zoom-reset-btn');
    const zoomFitBtn = document.getElementById('zoom-fit-btn');
    
    let currentZoom = 1.0;
    
    function applyZoom() {
        bubbleContainer.style.setProperty('--zoom', currentZoom);
    }
    
    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', () => {
            currentZoom = Math.min(2.0, currentZoom + 0.1);
            applyZoom();
        });
        zoomOutBtn.addEventListener('click', () => {
            currentZoom = Math.max(0.2, currentZoom - 0.1);
            applyZoom();
        });
        zoomResetBtn.addEventListener('click', () => {
            currentZoom = 1.0;
            applyZoom();
        });
        zoomFitBtn.addEventListener('click', () => {
            // Very simple heuristic for fit viewport: scale down based on number of items
            // A more complex approach would measure container width vs scroll width
            const count = document.querySelectorAll('.bubble').length;
            if (count > 20) currentZoom = 0.4;
            else if (count > 10) currentZoom = 0.6;
            else if (count > 5) currentZoom = 0.8;
            else currentZoom = 1.0;
            applyZoom();
        });
    }

    overviewBtn.addEventListener('click', () => {
        bubbleContainer.innerHTML = '';
        currentZoom = 1.0;
        applyZoom();
        const groupCols = document.querySelectorAll('.group-col');
        
        groupCols.forEach(col => {
            const nameEl = col.querySelector('.group-name-input');
            const name = nameEl.textContent.trim() || 'Unnamed';
            const count = col.querySelectorAll('.pdf-card').length;
            
            // Calculate size based on file count
            // Base size 100px + 10px per file, max 250px
            const size = Math.min(250, 100 + (count * 10));
            const titleFontSize = size > 150 ? 1 : 0.8;
            const countFontSize = size > 150 ? 1.5 : 1.1;
            
            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.style.width = `calc(${size}px * var(--zoom))`;
            bubble.style.height = `calc(${size}px * var(--zoom))`;
            
            bubble.innerHTML = `
                <span class="bubble-title" style="font-size: calc(${titleFontSize}rem * var(--zoom)); padding-top: calc(0.5rem * var(--zoom))">${name}</span>
                <span class="bubble-count" style="font-size: calc(${countFontSize}rem * var(--zoom))">${count}</span>
            `;
            
            bubble.addEventListener('click', () => {
                overviewModal.classList.add('hidden');
                col.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' });
                // Optional: flash the column to highlight it
                col.style.transition = 'box-shadow 0.3s';
                col.style.boxShadow = '0 0 20px rgba(59,130,246,0.8)';
                setTimeout(() => col.style.boxShadow = 'none', 1500);
            });
            
            bubbleContainer.appendChild(bubble);
        });
        
        overviewModal.classList.remove('hidden');
    });

    closeOverviewModal.addEventListener('click', () => {
        overviewModal.classList.add('hidden');
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

    let activeEventSource = null;

    function closeAiModalFunc() {
        aiModal.classList.add('hidden');
        aiStatusPanel.classList.add('hidden');
        startAiBtn.disabled = false;
        cancelAiBtn.disabled = false;
        if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
        }
    }

    if (closeAiModal) closeAiModal.addEventListener('click', closeAiModalFunc);
    if (cancelAiBtn) cancelAiBtn.addEventListener('click', closeAiModalFunc);

    if (startAiBtn) {
        startAiBtn.addEventListener('click', () => {
            const simTarget = parseFloat(document.getElementById('similarity-input').value) || 0.5;
            const aiEmbedModelInput = document.getElementById('ai-embed-model-input');
            const embedModel = aiEmbedModelInput ? aiEmbedModelInput.value.trim() : 'nomic-embed-text';
            const textModel = aiModelInput.value.trim() || 'llama3';
            const context = aiContextInput.value.trim();
            
            aiStatusPanel.classList.remove('hidden');
            aiStatusText.textContent = "Connecting to Ollama...";
            startAiBtn.disabled = true;

            let sseUrl = `/api/ai-group-stream?similarity=${simTarget}&model=${encodeURIComponent(textModel)}&embedModel=${encodeURIComponent(embedModel)}`;
            if (context) {
                sseUrl += `&context=${encodeURIComponent(context)}`;
            }
            activeEventSource = new EventSource(sseUrl);
            
            activeEventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.type === 'progress') {
                    aiStatusText.textContent = data.message;
                } else if (data.type === 'done') {
                    activeEventSource.close();
                    activeEventSource = null;
                    groups = data.groups;
                    renderBoard(groups);
                    updateCounts();
                    saveToLocal("Smart Grouped via Local AI");
                    closeAiModalFunc();
                } else if (data.type === 'error') {
                    activeEventSource.close();
                    activeEventSource = null;
                    aiStatusText.textContent = "Error: " + data.error;
                    aiStatusText.style.color = 'var(--danger)';
                    startAiBtn.disabled = false;
                    cancelAiBtn.disabled = false;
                }
            };
            
            activeEventSource.onerror = (err) => {
                activeEventSource.close();
                activeEventSource = null;
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
    
    // Fetch installed Ollama models and populate datalist
    try {
        fetch('/api/ollama-models')
            .then(res => res.json())
            .then(data => {
                const datalist = document.getElementById('ollama-models-list');
                if (datalist && data.models) {
                    // Start with some smart defaults that might not be installed yet
                    const defaults = ['nomic-embed-text', 'mxbai-embed-large', 'llama3', 'gemma2:2b', 'phi3'];
                    const installedNames = new Set(data.models.map(m => m.name));
                    
                    const allModels = [...new Set([...defaults, ...data.models.map(m => m.name)])];
                    
                    allModels.forEach(modelName => {
                        const option = document.createElement('option');
                        option.value = modelName;
                        if (installedNames.has(modelName)) {
                            const modelData = data.models.find(m => m.name === modelName);
                            if (modelData && modelData.size) {
                                const sizeGB = (modelData.size / (1024 * 1024 * 1024)).toFixed(1);
                                option.textContent = `${modelName} (${sizeGB} GB - Installed)`;
                            } else {
                                option.textContent = `${modelName} (Installed)`;
                            }
                        } else {
                            option.textContent = `${modelName} (Will download)`;
                        }
                        datalist.appendChild(option);
                    });
                }
            })
            .catch(err => console.error("Could not fetch Ollama models:", err));
    } catch (e) {
        console.error(e);
    }
});
