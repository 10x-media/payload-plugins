---
"@10x-media/analytics": minor
---

Adapter contract and surfacing engine foundation: the unified `AnalyticsAdapter` interface with capability flags, a `payload.kv`-cached read engine (request coalescing, bounded queue, exponential backoff, `expiresAt` TTL), the adapter registry and plugin factory, and an in-memory testing adapter.
