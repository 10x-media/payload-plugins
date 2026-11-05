---
"@10x-media/dedupe": minor
---

Merge sections: parts of the merge screen the host draws, for what a merge decides beyond the document's own fields, such as the records of another collection that point at it.

- `collections.<slug>.sections`: `{ key, Component, validate? }`. The component is drawn under the fields, in the screen's columns; `validate` can refuse the merge with a message before anything is written.
- `hooks.beforeRemove` receives `sections`, each section's value by key, inside the merge's transaction.
- `@10x-media/dedupe/client` exports `useMergeSection` (the merge's documents, `setValue`, and `setReady` to hold the merge back) and the cells the field rows are drawn with: `MergeRow`, `MergePick` (with `readOnly`), `MergeChecks`, `MergeCell`.
