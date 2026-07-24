# Full-Stack Abort Pattern

When implementing long-running processes (especially AI/LLM tasks):
1. **Frontend:** Attach an `AbortController.signal` to the `fetch` request.
2. **Express Server:** Listen to `res.on('close')` (and verify `!res.writableEnded`) to detect when the frontend has aborted the connection, and fire a server-side `AbortController`.
3. **Backend Logic:** Pass the server-side `AbortSignal` all the way down into deep function calls (e.g., loop iterations, sub-process calls, or API requests). Check `if (signal && signal.aborted) throw new Error(...)` frequently inside loops to halt execution immediately.
