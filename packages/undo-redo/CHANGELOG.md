# @10x-media/undo-redo

## 0.1.0-beta.2

### Minor Changes

- More built-in locales for the `undoRedo:` strings.

  - Added: `es`, `fr`, `id`, `pt`, `ru`, `zh`, `uk`, `ar`, `ko`. Every key is covered in each.

## 0.1.0-beta.1

### Patch Changes

- Stop a newly added array or blocks row from costing two undos. Payload adds a row as a blank one and leaves the row's own fields to the debounced form-state request that follows, so on a large config the capture can land between the two waves and record the half-built row as an entry of its own. A capture whose only difference from the current entry is paths that did not exist before is now folded into that entry rather than appended, which is the shape of Payload finishing a job rather than of an edit: every user action that adds paths also changes a row id or the value of the field controlling a condition. Folding rather than discarding keeps the entry able to restore the fields Payload filled in.

## 0.1.0-beta.0

### Minor Changes

- Add client-side undo/redo controls to every collection and global edit view. Form-state snapshots are captured on debounced field changes and restored through the form's `REPLACE_STATE` action, covering text edits and array/blocks row additions, deletions and moves. Keyboard shortcuts are `Ctrl+Z` / `Ctrl+Shift+Z` (and `Ctrl+Y`) outside text-editing surfaces. History is in-memory per editor session and independent of Payload versions and drafts.

- Extract the undo/redo logic into a `useUndoRedo` hook, exported from `@10x-media/undo-redo/client`. It owns the history, the capture debounce, the saved-state baseline and the keyboard chords, and returns `canUndo`, `canRedo`, `undo`, `redo`, `jumpTo` plus what the history inspector needs, so a host can pair `autoMount: false` with its own controls instead of restyling ours. `UndoRedoControls` is now presentation over the same hook. Shortcut targeting reads the form element from Payload's form context rather than from the controls' own DOM node, so the rule holds wherever the hook is called.

### Patch Changes

- Stop the history from recording a JSON field while its text does not parse. Payload keeps the raw editor text in form state as a string there, and renders the editor from `JSON.stringify(value)`, so restoring that string showed it escaped inside quotes instead of as the text the editor had. A capture taken while the text is broken now carries the field's last restorable value forward, so entries only ever describe states the form can be put back into: breaking the JSON alone records nothing, undo restores the last value that parsed, and redo never re-breaks it. The debug overlay stops reporting the field as a change that is forever pending.

- Stop polymorphic relationship and upload fields from producing history entries nobody asked for. Payload hands react-select's option objects straight to form state for a `relationTo` array, so the value carries `label` and `allowEdit` next to the reference, and those move on their own: a label refreshes when the related document is saved, `allowEdit` appears once permissions resolve, and the server merge after a save replaces the whole option with the bare reference. The last one appended an entry identical to the one before it, costing an extra undo to get past. Comparison now reduces such values to `relationTo` and `value`, which is the same line Payload's own change detection draws.
