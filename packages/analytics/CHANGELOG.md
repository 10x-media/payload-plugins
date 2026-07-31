# @10x-media/analytics

## 0.1.0-beta.3

### Patch Changes

- Make the rollup writer's Postgres import opaque to bundlers.

  The optional `@payloadcms/db-postgres` peer was loaded via a literal dynamic import, which bundlers resolve at build time: a Mongo host on Turbopack fails `next build` with "Module not found" even though the Postgres branch never runs there (and `serverExternalPackages` does not help, since it governs bundling, not resolution). The specifier is now built at runtime, so no bundler resolves it and the package is only touched when the adapter is actually Postgres. Mongo hosts that worked around this with a resolve alias or stub can remove it.

## 0.1.0-beta.2

### Minor Changes

- Add period-over-period comparison to the metric and trend widgets.

  When the active adapter declares `capabilities.comparison`, the widget read helpers also fetch (in parallel with the current window) the same count of whole reporting-timezone days immediately preceding the current window and return the previous value alongside the current one. The metric and trend widgets render a colored delta (up/down arrow with the percentage change) and a "vs. previous period" caption; metrics where lower is better (bounce rate) invert the coloring, and `allTime` never compares. The comparison is capability-gated, so adapters that cannot answer a second window omit it entirely and existing installs are unchanged; `widgets: { comparison: false }` skips the previous-window read.

  The previous window aligns to whole days in the reporting timezone so day-stamped rollup stores never lose their first day to a mid-day window start, and every comparison string routes through the typed `keys.ts` translations so it is fully localizable.

- Ship built-in German (`de`) translations alongside English. All admin strings (metrics, widgets, timeframes, provider fields, comparison captions) are covered; a project `translations` override still wins per key.

- Interactive per-document analytics panel and an authenticated document read endpoint.

  `analyticsTab` now renders an interactive panel by default: metric cards with period-over-period deltas (capability-gated, mirroring the widgets), a daily trend chart for the first metric, and a timeframe picker that refetches in place. Reads go through the new `GET /api/analytics/document` endpoint, which whitelists timeframes/metrics and enforces read access on the target document before answering, so analytics never leak for content the requester cannot see. Pass `interactive: false` for the previous static stats row. `readForField` (now exported from `/rsc` with `compare`, `series`, and `range` options) backs both paths.

  Widget config select fields carry `isClearable: false` (required metric/timeframe and the always-present data source/window have no meaningful cleared state), select option labels ship as static locale maps so `filterOptions` results survive form-state serialization, and analytics display fields no longer surface as empty list-view columns.

  The sync tier's `analytics-daily` collection is now hidden from the admin nav by default (it stays fully API-queryable); pass `sync: { hidden: false }` to surface it.

  The plugin now installs its runtime before the app's own `onInit` runs, so consumer init code (seeding, warming, sync passes) can already read through the plugin; custom widget authors also get the exported `widgetCardStyle` / `widgetLabelStyle` chrome.

- Fixes and improvements across widgets, caching, bindings, and the PostHog adapter.

  Widget metric selects now list only metrics a configured adapter can actually serve, mirroring the capability gating that already hides whole widgets. On a PostHog-only install the metric picker no longer offers `bounceRate` or other unsupported metrics, and breakdown widgets narrow the picker by both metric and their dimension.

  `cache.ttl` now overrides the adapter's `recommendedTtl`. Previously an adapter's recommendation always won, so setting `cache.ttl.aggregate` had no effect. An explicit value now wins; leave a value unset to keep each adapter's own recommendation.

  Binding `hostname` is now applied as a query filter by adapters that support it: PostHog (`properties.$host`), GA4 (`hostName`), and Plausible (`event:hostname`). It previously only partitioned the cache key without filtering. Umami and the native engine still ignore it (native rollups are not yet keyed by hostname).

  The PostHog adapter gains the `events` metric (total captured events, matching PostHog's own Events definition) and the `event` dimension (per-event-name breakdown). Requesting either switches the read off the `$pageview`-only filter; the pageview-family metrics stay pageview-scoped through conditional aggregation.

  The dashboard trend chart no longer flashes at a wrong width on first paint: it measures its container before paint and defers rendering the line until measured, removing the initial-load resize jump.

- **Breaking:** remove the unsupported `entries` and `exits` metric keys. No adapter ever implemented them and no widget surfaced real data for them, so they only widened the `MetricKey` union without a backing read path. Their translation keys (`metricEntries`, `metricExits`) are dropped as well; code referencing either key or the removed translation keys no longer compiles.

- Add `reportingTimezone` so daily analytics boundaries can align to an IANA timezone instead of always UTC.

  Day boundaries (timeframe windows, the daily series axis, native rollup buckets, and the surfacing cache key) now resolve through a reporting timezone that defaults to `'UTC'`. An install that does not set the option is unchanged.

  `reportingTimezone` accepts a fixed string (single-site, or forcing one zone) or a resolver `({ req, scope }) => string | null`. The resolver receives the already-resolved scope, so per-tenant (look up by scope), per-user-account (`req.user`), and selector (cookie/preference) strategies are all expressible with one option. Invalid or unresolvable zones fall back to UTC with a warning.

  Native rollups bucket into the resolved timezone's day at ingest. This keeps reads cheap and correct for a tenant's own zone, at the cost that changing the timezone does not re-bucket existing history, and a per-user selector cannot re-slice already-written native days (documented). External providers that accept a timezone are told the resolved zone: Umami via its `timezone` param, PostHog via `toStartOfDay(timestamp, '<zone>')`. GA4 and Plausible continue to bucket in their own account timezone.

  Options considered: (1) a fixed string only, rejected because it cannot vary per tenant or user; (2) a resolver only, rejected because it forces single-site consumers to write a function for a constant; (3) the shipped `string | resolver` union, chosen because it mirrors the existing `scopeResolver` pattern and serves every named use case with one familiar, testable option. For bucketing, write-time (per the "go for B, no historical re-bucketing" decision) was chosen over read-time re-bucketing, which would have required storing finer-grained rollups.

- Bucket the per-document trend chart in the reporting timezone, and show a "New" state for documents without analytics yet.

  The comparison windows, cache keys, and daily series already resolved on reporting-timezone day boundaries, but the trend chart still bucketed and labelled on UTC days. Any reporting timezone east of UTC (whose day starts fall on the previous UTC calendar day) therefore shifted every axis label, and the weekly and monthly groupings, back by a day. The chart now buckets and labels in the reporting timezone the read resolved in; the read helpers return that zone and the panel carries it in its endpoint payload for client-side re-bucketing. The default stays UTC, so existing installs are unchanged.

  A per-document analytics surface with nothing to show now reads as "New" rather than the flat "No analytics yet" line or a row of zeros captioned "No change vs. previous period". That covers both an unsaved or unbound document (no path resolves) and a saved page that has not gathered a single tracked metric yet. Genuine configuration states (not bound, no provider, unavailable) keep their message, since those are setup problems rather than new pages. The "New" label is localized (`keys.stateNew`, English and German) and the `analytics-empty-state` classes are stable hooks for overriding the look.

### Patch Changes

- Correct `payload` and `@payloadcms/ui` peer ranges to `^3.83.0`. The plugin uses `definePlugin`, which shipped in Payload 3.83.0, so 3.82.x installs satisfied the old range but failed at import.

## 0.1.0-beta.1

### Minor Changes

- Field, type, and resolver API fixes from user feedback.

  **Breaking:** `analyticsTab()` now returns a Payload `Tab` (as its name promises) instead of a whole tabs field, so it can be pushed into your own tabs field's `tabs` array. If you used it standalone in a `fields` array, switch to the new `analyticsTabsField()`:

  ```ts
  fields: [analyticsTab()]; // before
  fields: [analyticsTabsField()]; // after (same rendered result)
  ```

  Display fields no longer blank entirely when one requested metric is unsupported by the active adapter: unsupported metrics are dropped (logged once per field render with the dropped names and adapter id), the supported remainder renders, and the "not available" state shows only when nothing survives.

  Bindings are typed over `CollectionSlug`: the `collections` option keys are checked against your generated slugs and inline resolvers receive that collection's generated document type (degrading to `Record<string, unknown>` without generated types); `sync.collectionSlug` is checked the same way. `HostnameResolver` gains the same `(doc, ctx)` signature as `PathResolver` and may return `string | null | Promise<string | null>`; sync one-argument resolvers keep working.

  Widget config Titles can opt into localization via `widgets: { localizeText: true }`. Field factories accept label overrides wherever they hardcoded translation keys: `analyticsStat` takes `label`, the row/fields/tab factories take per-metric `labels`, and `analyticsTab` / `analyticsTabsField` take tab `label` and `description`, each as a string, locale map, or Payload label function. The date range picker placeholder is now translatable.

- Runtime provider configuration and multi-tenant scoping. New options: `scopeResolver` maps each request to an analytics boundary (tenant id, site key; null = whole install), `providers.collection` (false | true | object) scaffolds an admin collection where providers are configured at runtime per scope (masked secrets, overridable slug/fields/access, `scopeField` for tenant-plugin fields), `providers.resolve` replaces the collection lookup with a custom store, `platformAdapter` designates one config adapter shared by every scope, and `access.platformRead` gates cross-scope reads (default: any authenticated user). Scoped installs add an indexed scope column to native events and rollups (existing native installs need a migration), the posthog adapter gains `scopeProperty` for per-scope reads against one shared project, and `posthogProxyRewrites` (new `./next` subpath) returns Next.js rewrites for a first-party PostHog proxy.

  ```ts
  import { getTenantFromCookie } from "@payloadcms/plugin-multi-tenant/utilities";

  analytics({
    adapters: [
      native(),
      posthog({ projectId, apiKey, scopeProperty: "tenant" }),
    ],
    platformAdapter: "posthog",
    scopeResolver: ({ req }) => {
      const tenant = getTenantFromCookie(
        req.headers,
        req.payload.db.defaultIDType
      );
      return tenant === null ? null : String(tenant);
    },
    providers: { collection: { scopeField: "tenant" } },
  });
  ```

  Static `adapters` config and default behavior without the new options are unchanged.

- Add a typed `translations` option to every plugin factory and make translation keys a stable public API. Each plugin's `./i18n` subpath now exports the `keys` object, the `TranslationKey` union, and the `TranslationsOption` shape. Overrides are flat and per-locale: values win over the built-in locales key-by-key, locales a plugin does not ship are added whole, and app-level `i18n.translations` still wins over everything.

  ```ts
  import { analytics } from "@10x-media/analytics";
  import { keys } from "@10x-media/analytics/i18n";

  analytics({
    adapters: [nativeAdapter()],
    translations: {
      de: { [keys.pluginName]: "Analytik" },
    },
  });
  ```

  A typo'd key inside `translations` is a compile error.

### Patch Changes

- Declare `maxmind` and `@payloadcms/db-postgres` as optional peer dependencies. Both are loaded lazily (maxmind by the MaxMind geo resolver, `@payloadcms/db-postgres` by the atomic rollup path on Postgres), but they were previously bundled into the published package, which inlined the entire Postgres driver stack and the MaxMind reader into dist. Consumers on Postgres already have `@payloadcms/db-postgres` installed; Mongo-only consumers never load it. Install `maxmind` only if you use the MaxMind geo resolver.

- Preserve `'use client'` directives in shared build chunks so the `/client` and `/rsc` entries expose correct React Server Component boundaries. Client widgets (`RealtimeCounter`, `TrendChart`, `BarList`) that get hoisted into a shared chunk now keep their directive, preventing "use client" boundary errors in Next.js consumers.

- Restructure README: features, quick start, and links into the documentation site at https://docs.10xmedia.de. Long-form documentation moved out of the package README.

- Update README documentation links: the docs site now serves from the domain root, so `docs.10xmedia.de/docs/<plugin>` links became `docs.10xmedia.de/<plugin>`.

- Ship per-file dist output instead of bundled chunks. Bundling merged client components into shared chunks and dropped their 'use client' directives, so Next.js lost the RSC boundary and the admin panel crashed with "useRef only works in Client Components" when rendering components imported through such a chunk (for analytics: every chart-based dashboard widget). Dist now mirrors src one file at a time, directives stay exactly where they were authored, and file names are stable across releases. A repo-level `check:dist` verification (directive parity, no inlined dependencies, exports resolution, publint) now runs in CI so this class of regression cannot ship again.

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
