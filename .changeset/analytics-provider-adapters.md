---
"@10x-media/analytics": minor
---

Add Plausible and Umami provider adapters under the `@10x-media/analytics/adapters/plausible` and `@10x-media/analytics/adapters/umami` subpaths. Each implements the shared `AnalyticsAdapter` contract (per-URL queries, capability gating, normalized metrics) and plugs into the surfacing engine with no engine changes. Plausible uses Stats API v2 with self-hosted support; Umami supports both Cloud and self-hosted. GA4 and PostHog adapters follow in a later release.
