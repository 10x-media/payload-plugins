---
"@10x-media/analytics": minor
---

Add GA4 and PostHog provider adapters under the `@10x-media/analytics/adapters/ga4` and `@10x-media/analytics/adapters/posthog` subpaths, completing the Phase-1 adapter set. GA4 wraps the official `@google-analytics/data` SDK (an optional peer dependency loaded lazily, so only GA4 sites install it) and normalizes ratios and durations to the contract's percentage and millisecond units. PostHog derives web metrics with HogQL through the Query API, with US/EU Cloud and self-hosted hosts. Both implement the shared `AnalyticsAdapter` contract with per-URL queries and capability gating, and plug into the surfacing engine with no engine changes.
