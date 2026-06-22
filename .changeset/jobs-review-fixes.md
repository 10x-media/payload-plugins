---
'@10x-media/jobs': minor
---

Fix a batch of functional and security issues found in the jobs plugin review:

- Sweeper processes jobs oldest-first via `sort: 'updatedAt'` (item 5)
- `acquireOrSteal` treats `leaseExpiresAt: null` as stealable, preventing dead-lock on first-boot rows (item 6)
- `start()` is a no-op when a drain is already in progress, preventing loop restart during shutdown (item 7)
- Signal handler exits with code 1 on drain timeout, 0 on clean drain (item 8)
- `runControlEndpoint` returns 400 for non-finite `?limit=` values (item 9)
- Drain loop checks the deadline after each poll sleep to avoid overrunning the budget (item 10)
- Leadership is released immediately after stopping loops, before the poll-wait phase (item 11)
- Cron secret comparison uses `crypto.timingSafeEqual` to prevent timing attacks (item 12)
- `applyResume` / `PauseStore.resume` accept `{ all: true }` to reset both global and per-queue pause state (item 13)
- `stop()` removed from the public `Worker` type; accessible via `WorkerTestHandle` cast for tests (item 14)
- KV-stored pause state is validated on read; corrupt or missing values fall back to empty state (item 16)
- `config.jobs.access.run` is composed with the plugin's built-in checker (both must pass) instead of replacing it; the same composed checker also guards the plugin's own `/queue-run` and `/queue-sweep` endpoints, so a stricter `jobs.access.run` cannot be bypassed through them (item 17)
- `LeaseStore.release` returns `{ ok: boolean }`; `leaderController` only clears local leading state when the release was confirmed (item 18)
- `renew` filter includes `leaseExpiresAt >= now`; on failed renew while leading, the controller falls through to `acquireOrSteal` with a fence bump (item 19)
- `createWorker` throws when signal handlers are already installed, enforcing the one-worker-per-process constraint (item 21)
- `createWorker` defaults `pauseStore` to `createPauseStore(payload)`, eliminating the footgun where preset-enabled queue control was silently ignored (item 22)
- `sweepCycle` re-ticks the sweeper leadership before acting so the check is always fresh (item 23)
- `stampClaim` guards against double-claiming: a second owner cannot claim a job already held by a different node (item 24)
- `/queue-status` reports the seven canonical job states (`queued`, `scheduled`, `retrying`, `processing`, `succeeded`, `failed`, `cancelled`) plus an orthogonal `recovered` count (`recoveryAttempts > 0`, when reliability is enabled) (item 25, breaking change)
- In-flight job count is now process-local (incremented/decremented in `withHeartbeat`) instead of a DB query; on drain, `requeueStragglers` runs only when the wall-clock budget is exceeded, so a just-completed job is never spuriously requeued (genuinely orphaned claims are recovered by the sweeper) (item 26)
