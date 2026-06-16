---
"@10x-media/analytics": minor
---

Native engine gains an opt-in in-process write buffer (`native({ buffer: true })`) that coalesces per-request event, rollup, and dedup writes into batched, per-bucket upserts to cut database round-trips under load. Off by default (writes stay synchronous and durable); `native().flush()` drains the buffer for graceful shutdown.
