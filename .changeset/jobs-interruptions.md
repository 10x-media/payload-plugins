---
"@10x-media/jobs": minor
---

Interruptions: other plugins can pause queues through run gates and mark handler errors as interruptions, via a registry at `config.custom['@10x-media/jobs']`. An interrupted job fails for good by default (retries cut off) or, when opted in with `deferOnInterrupt` or `jobs({ interrupt: { defer } })`, goes back to the queue until the interruption ends without spending a retry. New exports: `checkpoint`, `JobDeferredError`, `resumeDeferred`, `applyJobInterruptions`, `wrapJobHandlers`, `evaluateRunGates`, and the registry types. Adds a `deferredBy` field to `payload-jobs`, so Postgres projects run one `migrate:create`.

The heartbeat now wraps handlers at init instead of at config time, so tasks and workflows added by plugins ordered after jobs heartbeat too.
