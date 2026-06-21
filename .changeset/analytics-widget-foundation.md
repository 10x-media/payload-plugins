---
"@10x-media/analytics": minor
---

Add dashboard widgets (Payload's experimental Modular Dashboard, PR #15700). The plugin registers capability-filtered widgets into `admin.dashboard.widgets`, starting with a configurable metric widget (pick a metric, a relative timeframe, and a data source when more than one adapter is configured) that reads through the surfacing engine. Widgets are on by default (`widgets: false` disables them, `widgets: { disabled: [...] }` drops specific slugs). Apps place widgets by spreading the exported `analyticsDefaultWidgets()` into their own `admin.dashboard.defaultLayout`; the plugin never sets `defaultLayout` itself.
