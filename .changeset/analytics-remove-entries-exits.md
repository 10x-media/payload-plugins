---
"@10x-media/analytics": minor
---

**Breaking:** remove the unsupported `entries` and `exits` metric keys. No adapter ever implemented them and no widget surfaced real data for them, so they only widened the `MetricKey` union without a backing read path. Their translation keys (`metricEntries`, `metricExits`) are dropped as well; code referencing either key or the removed translation keys no longer compiles.
