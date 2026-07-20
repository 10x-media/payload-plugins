---
"@10x-media/analytics": minor
---

Add period-over-period comparison to the metric and trend widgets.

When the active adapter declares `capabilities.comparison`, the widget read helpers also fetch (in parallel with the current window) the same count of whole reporting-timezone days immediately preceding the current window and return the previous value alongside the current one. The metric and trend widgets render a colored delta (up/down arrow with the percentage change) and a "vs. previous period" caption; metrics where lower is better (bounce rate) invert the coloring, and `allTime` never compares. The comparison is capability-gated, so adapters that cannot answer a second window omit it entirely and existing installs are unchanged; `widgets: { comparison: false }` skips the previous-window read.

The previous window aligns to whole days in the reporting timezone so day-stamped rollup stores never lose their first day to a mid-day window start, and every comparison string routes through the typed `keys.ts` translations so it is fully localizable.
