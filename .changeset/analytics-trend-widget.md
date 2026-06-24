---
"@10x-media/analytics": minor
---

Add a trend dashboard widget that draws a metric over time as a dependency-free SVG sparkline, backed by a new native day-granularity time-series read. The per-widget timeframe picker now offers a fuller set of relative ranges (today, last 7 days, last 30 days, last 90 days, this month, this year, last year, all time). The shared `TrendChart` primitive is exported from `@10x-media/analytics/client`. Provider adapters (Plausible, Umami, GA4, PostHog) do not yet emit time-series rows, so a trend widget pointed at a provider renders an empty line for now; the native engine is fully wired.
