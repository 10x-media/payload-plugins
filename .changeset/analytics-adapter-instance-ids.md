---
"@10x-media/analytics": minor
---

**Breaking:** runtime provider adapters now carry per-document instance ids (`posthog:<docId>`) instead of the plain provider id, so one scope can run several projects of the same provider type. The replace-by-id override rule is gone: runtime adapters append to the scope registry alongside config adapters (config adapters win id collisions), and a tenant preferring their own project selects it as the widget data source. Stored widget `dataSource` values and sync-tier `source` rows that referenced a runtime provider by its old plain id no longer resolve; reselect the source in affected widgets and expect new `source` values in `analytics-daily`. The adapter label shown in pickers is the provider document's `name`.
