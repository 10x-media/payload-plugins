---
"@10x-media/analytics": minor
---

**Additive:** the trend chart can overlay the previous period. `TrendChart` takes `comparison`, `comparisonLabel` and `label`, drawing the second series as a muted line on a y-scale covering both, with a legend and a tooltip row for each series. The trend widget gains a **Compare to previous period** checkbox (off by default) that reads the previous window's series through `readForWidgetSeries({ compare: true })`, which now returns `comparisonPoints` aligned to `points` by index; the existing period-over-period delta is unchanged. **Behavioral:** the analytics view's trend section draws one chart with the overlay instead of stacking a second chart for the previous period.
