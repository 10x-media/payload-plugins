---
"@10x-media/analytics": minor
---

Scope-aware widget pickers. A new authenticated `GET /api/analytics/sources` endpoint lists the adapters visible to the requesting scope (config adapters plus the scope's runtime providers) with their capabilities, and the widget `dataSource` and `metric` selects now render through client components that consume it: a tenant's own providers finally appear in pickers, labeled by the provider document's name (a generated label stands in when unset), and the metric list narrows to what the selected source can actually serve. Without JavaScript or when the endpoint is unreachable the pickers fall back to the config-time option lists, and stored values the endpoint no longer lists keep the previous behavior of degrading at read time.
