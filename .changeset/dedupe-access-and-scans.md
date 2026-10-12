---
"@10x-media/dedupe": minor
---

Merge as the reviewer, and keep scans and bulk writes in check.

- The merge writes the primary and the merged-in documents with `overrideAccess: false`, so Payload applies the collection's and the fields' access itself. A value a field's `update` access refuses in the write is refused before anything is written, rather than dropped. Freeing a unique value on a merged-in document needs the reviewer's update access on that field there.
- `DEDUPE_SKIP` in `req.context` keeps a bulk write from queuing a check per document (`'check'`), or from indexing too (`'all'`).
- A scan is one job per collection. "Scan now" and the schedule queue none for a collection whose scan is already waiting or running, and the queue shows the button as queued or running. The scan endpoint answers `{ inline: false, jobs, alreadyQueued }`.
- `scanQueue` runs the scans on a queue of their own, so they do not wait behind the checks a bulk write queued.
- `access.scan` decides who may start a scan; it defaults to `access.review`.
- Without transactions the merge screen no longer explains the database to the reviewer: with `requireTransactions` it only says merging is not available, without it it says nothing. The reason is logged at startup.
- `dedupeCustom({ mergeView: 'native' })` draws a list on the merge screen without its own `Field` component, so a split list whose component draws no row labels gets its row checks.
- The keys adapter's collection is added only when a matched collection searches with it. On Postgres, where it is no longer added, a migration drops its table.
