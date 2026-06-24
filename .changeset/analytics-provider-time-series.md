---
"@10x-media/analytics": minor
---

Provider adapters now honor `granularity: 'day'` and return a per-day series, so a trend widget backed by GA4, Plausible, PostHog, or Umami renders a real chart instead of a flat line. Range totals stay correct (distinct metrics are never summed across days). Umami's series covers pageviews and sessions; its other metrics keep a correct headline with an empty series.
