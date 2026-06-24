---
"@10x-media/analytics": minor
---

Add per-document binding and portable, read-only display fields. Bind any URL-bearing collection with a `path` resolver (or `pathField` fallback), then place `analyticsStat`, `analyticsStatRow`, `analyticsFields`, or the `analyticsTab` preset explicitly on your collections. Fields surface per-document metrics through the surfacing engine, are capability-gated against the active adapter, and inject nothing by default (sidebar placement is opt-in). Display components ship under the new `@10x-media/analytics/rsc` subpath.
