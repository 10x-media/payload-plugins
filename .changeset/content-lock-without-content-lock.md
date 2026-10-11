---
'@10x-media/content-lock': minor
---

`withoutContentLock(fn)` lets maintenance code write while a lock is active. Every Local API call in the callback's async chain, the hooks it fires included, runs as if nothing were locked; requests handled at the same time stay locked, and the banner, `isContentLocked` and paused queues still report the lock. Use it for the migrations and imports a lock exists to protect, never for request handlers or job runs.
