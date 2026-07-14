---
"@10x-media/analytics": minor
---

Fixes and improvements across widgets, caching, bindings, and the PostHog adapter.

Widget metric selects now list only metrics a configured adapter can actually serve, mirroring the capability gating that already hides whole widgets. On a PostHog-only install the metric picker no longer offers `bounceRate` or other unsupported metrics, and breakdown widgets narrow the picker by both metric and their dimension.

`cache.ttl` now overrides the adapter's `recommendedTtl`. Previously an adapter's recommendation always won, so setting `cache.ttl.aggregate` had no effect. An explicit value now wins; leave a value unset to keep each adapter's own recommendation.

Binding `hostname` is now applied as a query filter by adapters that support it: PostHog (`properties.$host`), GA4 (`hostName`), and Plausible (`event:hostname`). It previously only partitioned the cache key without filtering. Umami and the native engine still ignore it (native rollups are not yet keyed by hostname).

The PostHog adapter gains the `events` metric (total captured events, matching PostHog's own Events definition) and the `event` dimension (per-event-name breakdown). Requesting either switches the read off the `$pageview`-only filter; the pageview-family metrics stay pageview-scoped through conditional aggregation.

The dashboard trend chart no longer flashes at a wrong width on first paint: it measures its container before paint and defers rendering the line until measured, removing the initial-load resize jump.
