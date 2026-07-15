---
"@10x-media/analytics": minor
---

Add period-over-period comparison to the metric and trend widgets.

When the active adapter declares `capabilities.comparison`, the widget read helpers also fetch the equal-length window immediately preceding the current one and return the previous value alongside the current one. The metric and trend widgets render a colored delta (up/down arrow with the signed percentage) and a "vs. previous period" caption. The comparison is capability-gated, so adapters that cannot answer a second window omit it entirely and existing installs are unchanged.

The previous window inherits the current range's timezone alignment (it is derived from the same start/end instants), and every comparison string routes through the typed `keys.ts` translations so it is fully localizable.
