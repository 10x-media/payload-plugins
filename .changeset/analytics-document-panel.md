---
"@10x-media/analytics": minor
---

Interactive per-document analytics panel and an authenticated document read endpoint.

`analyticsTab` now renders an interactive panel by default: metric cards with period-over-period deltas (capability-gated, mirroring the widgets), a daily trend chart for the first metric, and a timeframe picker that refetches in place. Reads go through the new `GET /api/analytics/document` endpoint, which whitelists timeframes/metrics and enforces read access on the target document before answering, so analytics never leak for content the requester cannot see. Pass `interactive: false` for the previous static stats row. `readForField` (now exported from `/rsc` with `compare`, `series`, and `range` options) backs both paths.

Widget config drawers are condensed with paired rows (metric + timeframe, limit + data source, metric + window at 50% width each), select option labels ship as static locale maps so `filterOptions` results survive form-state serialization, and analytics display fields no longer surface as empty list-view columns.

The plugin now installs its runtime before the app's own `onInit` runs, so consumer init code (seeding, warming, sync passes) can already read through the plugin; custom widget authors also get the exported `widgetCardStyle` / `widgetLabelStyle` chrome.
