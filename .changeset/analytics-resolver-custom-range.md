---
"@10x-media/analytics": minor
---

Add a computed page-path resolver for on-document analytics fields: bind a collection with an async, request-aware `path(doc, ctx)` resolver and the field reads analytics for that path without persisting anything. Dashboard widgets gain a "Custom range" timeframe with a native date-range picker. Reads now coalesce within a UTC day, and over-long ranges are clamped to each provider's maximum lookback with a visible note.
