---
'@10x-media/dedupe': minor
---

Components above and below the queue.

- Added: `view.components.beforeList` and `view.components.afterList` render components on the queue's page, above its heading and below its pagination, as a collection's `admin.components` takes them. Each component receives the queue's current `collection` and `status`, and a server component also `payload`, `req` and `searchParams`. The prop types are exported as `DedupeQueueSlotProps` and `DedupeQueueSlotServerProps`.
- Each slot component is registered under `config.admin.dependencies`, so `payload generate:importmap` finds it.
