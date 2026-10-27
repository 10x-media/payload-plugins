---
'@10x-media/dedupe': minor
---

The queue's page: components above and below it, or a page of your own.

- Added: `view.queue.components.beforeList` and `view.queue.components.afterList` render components on the queue's page, above its heading and below its pagination, as a collection's `admin.components` takes them. Each component receives the queue's current `collection` and `status`, and a server component also `payload`, `req` and `searchParams`. The prop types are exported as `DedupeQueueSlotProps` and `DedupeQueueSlotServerProps`.
- Added: `view.queue: false` mounts only the merge screen. `DedupeQueue` from `@10x-media/dedupe/rsc` renders the queue without a page around it, for an admin view of your own at `view.path`.
- Each slot component is registered under `config.admin.dependencies`, so `payload generate:importmap` finds it.
