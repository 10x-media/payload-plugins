---
'@10x-media/undo-redo': minor
---

Extract the undo/redo logic into a `useUndoRedo` hook, exported from `@10x-media/undo-redo/client`. It owns the history, the capture debounce, the saved-state baseline and the keyboard chords, and returns `canUndo`, `canRedo`, `undo`, `redo`, `jumpTo` plus what the history inspector needs, so a host can pair `autoMount: false` with its own controls instead of restyling ours. `UndoRedoControls` is now presentation over the same hook. Shortcut targeting reads the form element from Payload's form context rather than from the controls' own DOM node, so the rule holds wherever the hook is called.
