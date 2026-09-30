---
'@10x-media/content-lock': minor
---

`assertContentUnlocked(req, target)` throws the lock's own `ContentLockedError` when a collection, global or custom target is frozen. Jobs that catch write errors per item, or pay for an external call before they write, call it first: the jobs integration then defers or fails them like a blocked write, before any work is done. `isContentLocked` and the new helper share an exported `ContentLockTarget` type.
