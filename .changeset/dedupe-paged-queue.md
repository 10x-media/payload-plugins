---
"@10x-media/dedupe": minor
---

The queue reads one page of groups instead of every pair, and its search can use the adapter's index.

- Every group of pairs keeps its strongest pair marked as its lead (`lead` on `dedupe-pairs`), settled after each write and at the end of a scan. The queue pages through leads in the database and walks only the groups it shows. Pairs stored by an earlier version get their leads the first time the queue opens. On Postgres, add a migration for the new `lead` column.
- `search({ req, collection, search, limit })` on an adapter answers the queue's search box, so a search index with typo tolerance finds what the list search misses. Without it the queue searches as the collection's list view does, the first 250 documents found.
- `view.queue: false` mounts only the merge screen; the host renders the queue in a page of its own with `DedupeQueue` from `@10x-media/dedupe/rsc`.
