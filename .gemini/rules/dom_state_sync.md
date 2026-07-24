# DOM State Synchronization

In applications where the DOM is the "single source of truth" (e.g., Kanban boards reading datasets from HTML elements):
- **Never** attempt to serialize, save, or push to history until the DOM has been fully updated.
- If you receive new data from a backend, the sequence of operations MUST always be:
  1. `renderBoard(newData)` (Update the DOM)
  2. `updateCounts()` (Update UI counters)
  3. `saveToLocal()` / `pushToHistory()` (Extract the new DOM state and save it)
- Attempting to save the state before rendering will result in saving the *previous* state.
