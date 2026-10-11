---
'@10x-media/content-lock': patch
---

A kv store that rejects writes no longer locks everything, jobs deferred while the lock state cannot be read run again after a minute, and concurrent reads of the lock state share one read.

- Fixed: a kv store that answers reads but rejects writes (Redis at `maxmemory` under `volatile-lru` rejects a SET without TTL) locked everything and paused every queue, because each read that rebuilt the snapshot failed although it had read the windows from the collection. Those windows are now enforced and the failed write is logged. Everything still locks while the lock state itself cannot be read. Saving or deleting a window still fails while its snapshot cannot be stored, so a save never reports a change that other servers do not see yet.
- Fixed: a job that defers on interrupt and was stopped while the lock state could not be read waited a day, and nothing released it sooner, so a scheduled publish that ran into a kv outage went out a day late. It now runs again after a minute. Windows without an end still defer their jobs for a day, until **End now** releases them.
- Concurrent reads of the lock state share one read per Payload instance. An admin page that resolves permissions for every collection makes one kv read instead of one per collection and operation, and a stale snapshot is rebuilt once instead of once per caller. A failed read is not kept: the next call reads again.
