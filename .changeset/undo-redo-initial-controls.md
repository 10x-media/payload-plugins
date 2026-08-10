---
'@10x-media/undo-redo': minor
---

Add client-side undo/redo controls to every collection and global edit view. Form-state snapshots are captured on debounced field changes and restored through the form's `REPLACE_STATE` action, covering text edits and array/blocks row additions, deletions and moves. Keyboard shortcuts are `Ctrl+Z` / `Ctrl+Shift+Z` (and `Ctrl+Y`) outside text-editing surfaces. History is in-memory per editor session and independent of Payload versions and drafts.
