# @10x-media/dedupe

## 4.0.0-alpha.1

### Major Changes

- Payload 4 support, on Next.js and TanStack Start. `next` and `@payloadcms/next` are no longer peers. On a drafts collection with localized fields, Payload 4 publishes each locale on its own, and the merge now keeps the primary's status per locale: a locale the primary is published in is published with the merged values, a locale it is a draft in is written as a draft and stays unpublished (checked only when the collection validates drafts), and the values the locales share are written in a published locale; a document counts as published while any locale is. Folder and tag fields are the project's own on Payload 4: the folder special case is gone, and a field that hides itself in the document form with `NullField` is shown on the merge screen as its value. Blocks named by slug from the config's `blocks` are compared and drawn like inline ones. Scan jobs always carry their concurrency key, since Payload 4 removes `jobs.enableConcurrencyControl`; the check on save is not keyed, so the checks of many saves in one collection run side by side. The plugin's internal reads, writes and `jobs.queue` calls pass `overrideAccess: true` where Payload 4 now applies access by default; the merge still writes as the reviewer. The pairs and keys collections opt out of Payload 4's default versions and authorship. The queue is built from Payload 4's list parts: its list header with the tabs, a list-controls band with the search, the collection filter and Scan now, and Payload's page controls pinned to the bottom. The merge screen uses Payload 4's tokens, banners and buttons, its column head has ghost icon buttons, its footer stays pinned to the bottom of the window as the list view's page controls do, differences carry the version view's word marks, and rich text differences use Payload 4's Lexical diff styles and relationship markup. Requires Payload `4.0.0-beta.7`. See Upgrading to Payload 4 in the docs.

## 0.1.0-beta.3

### Minor Changes

- The queue reads one page of groups instead of every pair, and its search can use the adapter's index.

  - Every group of pairs keeps its strongest pair marked as its lead (`lead` on `dedupe-pairs`), settled after each write and at the end of a scan. The queue pages through leads in the database and walks only the groups it shows. Pairs stored by an earlier version get their leads the first time the queue opens. On Postgres, add a migration for the new `lead` column.
  - `search({ req, collection, search, limit })` on an adapter answers the queue's search box, so a search index with typo tolerance finds what the list search misses. Without it the queue searches as the collection's list view does, the first 250 documents found.
  - `view.queue: false` mounts only the merge screen; the host renders the queue in a page of its own with `DedupeQueue` from `@10x-media/dedupe/rsc`.

## 0.1.0-beta.2

### Minor Changes

- `title` on a collection names its documents on the merge screen, in the queue and in the duplicate check: `({ req, doc, title }) => string`, given the `useAsTitle` title and the document with its hidden fields.

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
