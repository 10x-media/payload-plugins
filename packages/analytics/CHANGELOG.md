# @10x-media/analytics

## 0.1.0-beta.0

### Minor Changes

- Add four breakdown dashboard widgets (Top pages, Top sources, Devices, Countries) that rank one metric by a dimension as a dependency-free bar list, exported as the shared `BarList` primitive from `@10x-media/analytics/client`. The native engine now captures `source` (derived from the referrer) and `device` (classified from the user-agent) alongside page and country, so all four breakdowns are native-backed. Each breakdown widget is capability-gated on its dimension, so providers that do not report a dimension simply do not register that widget.

- Redesign the dashboard widget charts. The trend widget is now a gradient area chart with a monotone-cubic curve, gridlines, dots, timeframe-aware x-axis labels (weekdays for a 7-day range, dates for a month, months for a year), and a hover tooltip. The breakdown widgets render shadcn-style filled bars with the label inside the bar, the value outside, and a hover tooltip. Series colors use overridable `--analytics-chart-1` / `--analytics-chart-2` tokens (no more disabled-gray). Every widget gains an editable title with its sensible default shown as the field's placeholder. All hand-rolled SVG and CSS with Payload design tokens; no new dependencies.

- Add per-document binding and portable, read-only display fields. Bind any URL-bearing collection with a `path` resolver (or `pathField` fallback), then place `analyticsStat`, `analyticsStatRow`, `analyticsFields`, or the `analyticsTab` preset explicitly on your collections. Fields surface per-document metrics through the surfacing engine, are capability-gated against the active adapter, and inject nothing by default (sidebar placement is opt-in). Display components ship under the new `@10x-media/analytics/rsc` subpath.

- Adapter contract and surfacing engine foundation: the unified `AnalyticsAdapter` interface with capability flags, a `payload.kv`-cached read engine (request coalescing, bounded queue, exponential backoff, `expiresAt` TTL), the adapter registry and plugin factory, and an in-memory testing adapter.

- Add GA4 and PostHog provider adapters under the `@10x-media/analytics/adapters/ga4` and `@10x-media/analytics/adapters/posthog` subpaths, completing the Phase-1 adapter set. GA4 wraps the official `@google-analytics/data` SDK (an optional peer dependency loaded lazily, so only GA4 sites install it) and normalizes ratios and durations to the contract's percentage and millisecond units. PostHog derives web metrics with HogQL through the Query API, with US/EU Cloud and self-hosted hosts. Both implement the shared `AnalyticsAdapter` contract with per-URL queries and capability gating, and plug into the surfacing engine with no engine changes.

- Native engine: optional MaxMind GeoLite2 geo resolver with graceful degradation (empty geo when the lib or database is missing), composable geo resolvers, a `./geo` export subpath, and a configurable retention prune task for raw events.

- Native analytics engine core loop: a beacon ingestion endpoint, the events + rollups collections, cross-db atomic rollups (Mongo and Postgres), and the native() adapter (pageviews, events, avgDuration).

- Add Plausible and Umami provider adapters under the `@10x-media/analytics/adapters/plausible` and `@10x-media/analytics/adapters/umami` subpaths. Each implements the shared `AnalyticsAdapter` contract (per-URL queries, capability gating, normalized metrics) and plugs into the surfacing engine with no engine changes. Plausible uses Stats API v2 with self-hosted support; Umami supports both Cloud and self-hosted. GA4 and PostHog adapters follow in a later release.

- Provider adapters now honor `granularity: 'day'` and return a per-day series, so a trend widget backed by GA4, Plausible, PostHog, or Umami renders a real chart instead of a flat line. Range totals stay correct (distinct metrics are never summed across days). Umami's series covers pageviews and sessions; its other metrics keep a correct headline with an empty series.

- Add a realtime "active now" dashboard widget: native serves a live count of active visitors (or pageviews) in the last N minutes plus a per-minute sparkline, polled from an authenticated endpoint every 15 seconds. The widget registers only when a realtime-capable adapter is configured; providers can implement realtime later through the same capability gate.

- Add a public extension API for dashboard widgets: register your own widget with `widgets: { register: [...] }` (capability-gated, slug-validated), and build its server component from the now-public reads (`readForWidget`, `readForWidgetSeries`, `readForWidgetBreakdown`, `readForWidgetRealtime`) plus `formatMetricValue` from `@10x-media/analytics/rsc` and the chart primitives from `@10x-media/analytics/client`.

- Add a computed page-path resolver for on-document analytics fields: bind a collection with an async, request-aware `path(doc, ctx)` resolver and the field reads analytics for that path without persisting anything. Dashboard widgets gain a "Custom range" timeframe with a native date-range picker. Reads now coalesce within a UTC day, and over-long ranges are clamped to each provider's maximum lookback with a visible note.

- Add an opt-in scheduled cache-warm job. Set `cache: { warm: true }` (or `cache: { warm: { cron } }`) to register a Payload task (`analytics-warm-cache`) that pre-runs the dashboard's widget reads on a cron, deriving its targets from `admin.dashboard.defaultLayout`, so a provider-backed dashboard loads from warm `payload.kv` cache. Realtime and custom widgets are skipped; one provider failure does not abort the rest. Off by default.

- Add an opt-in sync tier. Set `sync: true` (or `sync: { cron, lookbackDays, collectionSlug, adapters }`) to register a queryable `analytics-daily` collection and a Payload task (`analytics-sync`) that, on a cron, ETLs each configured provider's last N days of daily metrics into one upserted row per `(source, date)`. The collection is queryable via Payload's APIs; native is excluded; one provider failure does not abort the rest. Off by default.

- Add a trend dashboard widget that draws a metric over time as a dependency-free SVG sparkline, backed by a new native day-granularity time-series read. The per-widget timeframe picker now offers a fuller set of relative ranges (today, last 7 days, last 30 days, last 90 days, this month, this year, last year, all time). The shared `TrendChart` primitive is exported from `@10x-media/analytics/client`. Provider adapters (Plausible, Umami, GA4, PostHog) do not yet emit time-series rows, so a trend widget pointed at a provider renders an empty line for now; the native engine is fully wired.

- Native engine now tracks unique visitors and sessions with exact cross-database distinct counting (Mongo and Postgres), plus a site-wide country breakdown dimension and a `page` breakdown for top-pages views. The seen-ledger is pruned by the retention task.

- Add dashboard widgets (Payload's experimental Modular Dashboard, PR #15700). The plugin registers capability-filtered widgets into `admin.dashboard.widgets`, starting with a configurable metric widget (pick a metric, a relative timeframe, and a data source when more than one adapter is configured) that reads through the surfacing engine. Widgets are on by default (`widgets: false` disables them, `widgets: { disabled: [...] }` drops specific slugs). Apps place widgets by spreading the exported `analyticsDefaultWidgets()` into their own `admin.dashboard.defaultLayout`; the plugin never sets `defaultLayout` itself.

- Native engine gains an opt-in in-process write buffer (`native({ buffer: true })`) that coalesces per-request event, rollup, and dedup writes into batched, per-bucket upserts to cut database round-trips under load. Off by default (writes stay synchronous and durable); `native().flush()` drains the buffer for graceful shutdown.
