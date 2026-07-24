# Natural Sorting

Whenever writing JavaScript code that sorts arrays of strings, titles, or group names intended for the user interface, **always** use Natural Sorting so that numbers within the strings are ordered logically (e.g., 2 comes before 10).

Use the `numeric: true` option in `localeCompare`:
```javascript
// DO NOT do this:
array.sort((a, b) => a.name.localeCompare(b.name));

// ALWAYS do this:
array.sort((a, b) => a.name.localeCompare(b.name, { numeric: true, sensitivity: 'base' }));
```
