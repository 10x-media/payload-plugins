---
'@10x-media/folder-picker': minor
---

The folder tab stops offering what the field cannot take, and says how to pick more than one.

- **A file the field already holds no longer appears.** Payload's upload field hides its current value from the list tab by building `filterOptions` with `id: { not_in: [...] }`, but the folder server function takes no filter, so the folder tab kept offering those files. Picking one again stored it twice, because the field appends whatever the drawer hands it. The same rule is now applied to the folder's results, for single-value fields as well as `hasMany`, and removing a value puts the file back among the options.
- **Multi-selection is limited to `hasMany` fields.** It was enabled everywhere, so on a single-value field Ctrl and Shift built a selection the field could not accept and the confirm pill counted files that were then dropped.
- **A hint under the header explains the modifiers**, for `hasMany` fields only, where a selection can actually hold several. It draws `⌘` and `⇧` on macOS and spells `Ctrl` and `Shift` out everywhere else.
- **German and Ukrainian locales**, alongside the English the plugin already shipped. Every string is checked against the English key set, and against the placeholders each one carries.
