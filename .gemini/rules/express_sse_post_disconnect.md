# Express SSE/Streaming POST Disconnects

When implementing Server-Sent Events (SSE) or chunked streaming responses over a `POST` request in Express:
- **DO NOT** listen to `req.on('close')` to detect if the client has dropped the connection. The `req` stream closes as soon as the POST body is fully parsed, which will trigger false-positive disconnects.
- **DO** listen to `res.on('close')`.
- Inside the event handler, always check `if (!res.writableEnded)` to confirm that the connection was actually dropped by the client before the server finished sending its stream.

Example:
```javascript
res.on('close', () => {
    if (!res.writableEnded) {
        // Client aborted/dropped connection early
        abortController.abort();
    }
});
```
