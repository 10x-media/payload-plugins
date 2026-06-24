---
"@10x-media/analytics": minor
---

Add four breakdown dashboard widgets (Top pages, Top sources, Devices, Countries) that rank one metric by a dimension as a dependency-free bar list, exported as the shared `BarList` primitive from `@10x-media/analytics/client`. The native engine now captures `source` (derived from the referrer) and `device` (classified from the user-agent) alongside page and country, so all four breakdowns are native-backed. Each breakdown widget is capability-gated on its dimension, so providers that do not report a dimension simply do not register that widget.
