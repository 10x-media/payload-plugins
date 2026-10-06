---
"@10x-media/analytics": minor
---

Engine hardening. Provider reads now run under a real timeout (`cache.timeoutMs`, default 15s) delivered to adapters as `AdapterContext.signal`, retry with backoff only on 429/5xx (one retry for network failures, none for other 4xx or aborts), and respect each adapter's declared rate limits through per-adapter token buckets (`requestsPerMinute`/`requestsPerHour`/`maxConcurrent`). When a refresh fails and an expired cache entry is still within a 24 hour stale window, the read serves it flagged `meta.stale: true` instead of degrading, and failures are logged with the adapter id. Also: native `realtime()` now honors `hostname` and `path` the way aggregate reads do, multiple filters on one dimension compose as AND instead of last-wins, and the client-side capability check mirrors the server's filter requirements.
