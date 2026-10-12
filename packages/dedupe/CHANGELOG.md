# @10x-media/dedupe

## 0.1.0-beta.1

### Minor Changes

- Merge as the reviewer, and keep scans and bulk writes in check.

  - The merge writes the primary and the merged-in documents with `overrideAccess: false`, so Payload applies the collection's and the fields' access itself. A value a field's `update` access refuses in the write is refused before anything is written, rather than dropped. Freeing a unique value on a merged-in document needs the reviewer's update access on that field there.
  - `DEDUPE_SKIP` in `req.context` keeps a bulk write from queuing a check per document (`'check'`), or from indexing too (`'all'`).
  - A scan is one job per collection. "Scan now" and the schedule queue none for a collection whose scan is already waiting or running, and the queue shows the button as queued or running. The scan endpoint answers `{ inline: false, jobs, alreadyQueued }`.
  - `scanQueue` runs the scans on a queue of their own, so they do not wait behind the checks a bulk write queued.
  - `access.scan` decides who may start a scan; it defaults to `access.review`.
  - Without transactions the merge screen no longer explains the database to the reviewer: with `requireTransactions` it only says merging is not available, without it it says nothing. The reason is logged at startup.
  - `dedupeCustom({ mergeView: 'native' })` draws a list on the merge screen without its own `Field` component, so a split list whose component draws no row labels gets its row checks.
  - The keys adapter's collection is added only when a matched collection searches with it. On Postgres, where it is no longer added, a migration drops its table.

## 0.1.0-beta.0

### Minor Changes

- Find duplicate documents in any collection and merge a group of them into one from the admin: a duplicate search on save and in a scan, a queue, and a merge screen.

- Merge sections: parts of the merge screen the host draws, for what a merge decides beyond the document's own fields, such as the records of another collection that point at it.

  - `collections.<slug>.sections`: `{ key, Component, validate? }`. The component is drawn under the fields, in the screen's columns; `validate` can refuse the merge with a message before anything is written.
  - `hooks.beforeRemove` receives `sections`, each section's value by key, inside the merge's transaction.
  - `@10x-media/dedupe/client` exports `useMergeSection` (the merge's documents, `setValue`, and `setReady` to hold the merge back) and the cells the field rows are drawn with: `MergeRow`, `MergePick` (with `readOnly`), `MergeChecks`, `MergeCell`.
