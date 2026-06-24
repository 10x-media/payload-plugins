---
"@10x-media/analytics": minor
---

Add a public extension API for dashboard widgets: register your own widget with `widgets: { register: [...] }` (capability-gated, slug-validated), and build its server component from the now-public reads (`readForWidget`, `readForWidgetSeries`, `readForWidgetBreakdown`, `readForWidgetRealtime`) plus `formatMetricValue` from `@10x-media/analytics/rsc` and the chart primitives from `@10x-media/analytics/client`.
