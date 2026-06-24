# @10x-media/analytics

Adapter-based analytics for Payload v3: a unified adapter contract and a cached surfacing engine. Provider adapters (GA4, Plausible, Umami, PostHog), the native analytics engine, dashboard widgets, and portable fields land in subsequent releases.

> Status: foundation (beta). This release ships the adapter contract and the surfacing engine. It is not useful on its own yet without an adapter.

## Install

```bash
pnpm add @10x-media/analytics
```

## Usage

```ts
import { buildConfig } from 'payload'
import { analytics } from '@10x-media/analytics'

export default buildConfig({
  plugins: [
    analytics({
      adapters: [/* one or more AnalyticsAdapter instances */],
    }),
  ],
})
```

Pass `false` to disable without removing the call:

```ts
analytics(false)
```

## The adapter contract

Every provider and the native engine implement one `AnalyticsAdapter` interface. Author your own adapter against the published types:

```ts
import type { AnalyticsAdapter } from '@10x-media/analytics/types'
```

An adapter declares its `capabilities` (which metrics and dimensions it supports, realtime, rate limits, recommended cache TTLs). The surfacing engine reads through `payload.kv` with request coalescing, a bounded queue, and exponential backoff, so unconfigured adapters and provider outages degrade gracefully.

## Testing

`@10x-media/analytics/testing` exports `memoryAdapter()`, a deterministic in-memory adapter for tests and local development.

## Native engine (beta)

`@10x-media/analytics/adapters/native` exports `native()`, a self-hosted analytics engine that stores data inside Payload itself.

```ts
import { native } from '@10x-media/analytics/adapters/native'

analytics({ adapters: [native()] })
```

Registering the adapter adds three hidden collections (`analytics-events`, `analytics-rollups`, and `analytics-seen`) and a `POST /api/analytics/ingest` beacon endpoint. Events are written atomically via `$inc` (Mongo) or `ON CONFLICT DO UPDATE` (Postgres), so concurrent ingestion is safe.

**Write batching (opt-in):** by default each ingest is written synchronously before the endpoint responds. Pass `buffer: true` (or `buffer: { maxSize, maxAgeMs }`) to batch writes in memory and flush on size (default 50) or age (default 2000 ms), coalescing per-bucket upserts to cut database round-trips under load.

> Buffering trades durability for throughput: the endpoint responds before the batch is persisted, so a hard crash can lose up to `maxAgeMs` of unflushed events (the same best-effort model as Plausible and Umami). Call `native().flush()` on graceful shutdown to drain the buffer.

```ts
import { native } from '@10x-media/analytics/adapters/native'

analytics({ adapters: [native({ buffer: true })] })
```

Supported metrics: `pageviews`, `events`, `avgDuration`, `visitors`, `sessions`.

The native engine pre-aggregates unique visitors and sessions alongside pageviews. Distinct counts are computed exactly via a dedicated `analytics-seen` ledger and stored at every granularity they are queried (per page, site-wide, and site-wide per country), so they are read directly and never summed across the page or country breakdowns. Within a single UTC day a unique count is exact; across a multi-day range the daily counts are summed, so longer-range uniques are approximate (the same tradeoff Plausible, Fathom, and Umami make). A site-wide country breakdown dimension is available out of the box; geoless events are simply omitted from it.

**Production note (Mongo):** exact distinct counting relies on a unique index on the `analytics-seen` collection, which under concurrent ingestion must be live, so the Mongoose adapter should be configured with `ensureIndexes: true`:

```ts
import { mongooseAdapter } from '@payloadcms/db-mongodb'

mongooseAdapter({ url: process.env.DATABASE_URI, ensureIndexes: true })
```

On Postgres the unique index is created by migrations, so no extra configuration is needed once migrations have run.

### Geo resolution

The native engine resolves the visitor country, region, and city from each ingest request. Resolution is layered: platform-injected headers (`x-vercel-ip-country`, `cf-ipcountry`, and friends) are checked first. MaxMind GeoLite2 is tried only when headers do not already supply a country.

**MaxMind (optional)** Pass `geoDbPath` to enable IP-level lookup:

```ts
native({ geoDbPath: '/data/GeoLite2-City.mmdb' })
```

This requires the optional `maxmind` peer dependency and a downloaded `.mmdb` file. If the library is not installed, the file is missing or unreadable, or a lookup fails, geo resolution degrades to empty fields. A single warning is logged and ingestion continues unaffected.

**Custom geo pipeline** The `@10x-media/analytics/geo` subpath exports the building blocks for your own resolver:

```ts
import {
  platformHeaderResolver,
  maxmindResolver,
  composeGeoResolvers,
  noopResolver,
  type GeoResolver,
  type Geo,
} from '@10x-media/analytics/geo'
```

Compose resolvers left-to-right; the first non-empty value wins:

```ts
native({
  geoResolver: composeGeoResolvers(platformHeaderResolver, maxmindResolver({ dbPath: '...' })),
})
```

### Retention pruning

Pass `retentionDays` to register a nightly Payload task that deletes raw `analytics-events` older than N days:

```ts
native({ retentionDays: 90 })
```

The task runs at 03:00 UTC. If `retentionDays` is not set, no task is registered and raw events are kept indefinitely.

## Document binding

Bind any URL-bearing collection to its analytics with a per-collection path resolver. Binding a collection registers the resolver only; it renders no fields and injects nothing.

```ts
analytics({
  adapters: [native()],
  collections: {
    pages: {
      path: (doc) => (doc.slug ? `/${doc.slug}` : null), // primary resolver
      // pathField: 'permalink',                          // optional explicit-field fallback
      // hostname: 'example.com',                         // optional, for multi-domain
    },
  },
})
```

The resolver returns the document's URL pathname (or `null` for an unsaved document). `pathField` is a fallback used only when the resolver is absent or returns `null`; a binding must define at least one of the two.

### Computed page paths

The `path` resolver is a plain function with the signature `(doc, ctx) => string | null | Promise<string | null>`. It receives `ctx.req` (a `PayloadRequest`), so it can look up related documents:

```ts
analytics({
  adapters: [native()],
  collections: {
    posts: {
      path: async (doc, ctx) => {
        if (!doc.slug) return null
        // look up a related category to build the path
        const cat = await ctx.req.payload.findByID({
          collection: 'categories',
          id: doc.category as string,
          req: ctx.req,
        })
        return `/${cat.slug}/${doc.slug}`
      },
    },
  },
})
```

Nothing is persisted - the path is computed at read time and memoized once per request. Keep resolvers cheap: they may be called for many documents in a single list request. If you must look up related docs, pass `req` so Payload dedupes calls through its request data loader. When the path is already stored on the document, `pathField` is the zero-cost alternative.

## Portable display fields

Read-only fields you place explicitly on your own collections. Nothing is auto-injected, and nothing lands in the sidebar unless you ask for it. Each field surfaces metrics for the document's bound path through the surfacing engine, and auto-disables when the active adapter cannot supply the requested metric.

```ts
import { analyticsStat, analyticsStatRow, analyticsFields, analyticsTab } from '@10x-media/analytics'

fields: [
  analyticsStat({ metric: 'pageviews' }),                 // a single stat
  analyticsStat({ metric: 'visitors', position: 'sidebar' }), // opt in to the sidebar
  analyticsStatRow({ metrics: ['pageviews', 'visitors', 'avgDuration'] }), // a row of stats
  ...analyticsFields({ metrics: ['pageviews', 'sessions'] }), // several individual fields
  analyticsTab(),                                         // a ready-made "Analytics" tab
]
```

Every factory accepts an optional `timeframe` (a relative preset: `today`, `last7days`, `last30days`, `last90days`, `thisMonth`, `thisYear`; default `last30days`) and `adapter` (an adapter id, when more than one is configured). The native engine backs `pageviews`, `visitors`, `sessions`, `events`, and `avgDuration`; fields requesting anything else render a muted "not available" state until a provider that supports it is configured.

The display components are server components; add `@10x-media/analytics/rsc` to your Payload import map (run `payload generate:importmap`) so the admin can resolve them.

## Dashboard widgets

The plugin registers capability-filtered widgets into `admin.dashboard.widgets`. A widget that requires a metric no configured adapter supports is not registered, so dead surfaces never appear.

Widgets are enabled by default. Disable them entirely with `widgets: false`, or drop specific slugs with `widgets: { disabled: ['analytics-metric'] }`.

The widgets that ship today: a **metric** widget (a single headline number), a **trend** widget (a gradient area chart of one metric over time, with timeframe-aware axis labels [weekdays for a 7-day range, months for a year] and a hover tooltip), four **breakdown** widgets that rank one metric by a dimension as a filled bar list (**Top pages**, **Top sources**, **Devices**, **Countries**), and a **realtime** widget that shows a live "active now" count (active visitors or pageviews in the last few minutes) with a per-minute sparkline. The realtime widget polls an authenticated `GET /api/analytics/realtime` endpoint every 15 seconds, so the number updates without reloading the dashboard. It is native-backed and registers only when a realtime-capable adapter is configured; external providers can implement realtime later through the same capability gate. Each widget is configurable per instance: an editable title (a sensible default shows as the field's placeholder), a metric, a relative timeframe (today, last 7 days, last 30 days, last 90 days, this month, this year, last year, or all time), and (when more than one adapter is configured) a data source. A widget whose dimension no configured adapter supports is not registered, so a provider that does not report devices simply has no Devices widget.

The Timeframe selector also includes a **Custom range** option that reveals a native date-range picker, letting you query any arbitrary from/to window. For external providers that enforce a maximum lookback (for example GA4 or Plausible tiers), a range that exceeds the limit is automatically narrowed to the provider maximum and the widget shows a short note below the caption so the narrowing is visible.

The charts are dependency-free SVG and CSS themed with Payload's design tokens. The series color comes from `--analytics-chart-1`, which a consuming app can override in its admin stylesheet.

Trend widgets render a real daily series for every provider. GA4, Plausible, and PostHog cover all of their supported metrics; Umami's series covers pageviews and sessions (its API has no per-day source for visitors, bounce rate, or average duration, so a trend on those metrics shows a correct headline with an empty series). The headline total is always range-correct: distinct metrics like visitors are never summed across days.

A plugin must never set `admin.dashboard.defaultLayout` (Payload applies it with `??=`; a setter would clobber the app's own layout). Instead, the app places widgets by spreading the exported helper into its own config:

```ts
import { analytics, analyticsDefaultWidgets } from '@10x-media/analytics'
import { native } from '@10x-media/analytics/adapters/native'

export default buildConfig({
  admin: {
    dashboard: { defaultLayout: [...analyticsDefaultWidgets()] },
  },
  plugins: [analytics({ adapters: [native()] })],
})
```

`analyticsDefaultWidgets()` returns a wide pageviews trend plus two small metric widgets (pageviews and visitors), all over the last 30 days. If you set `widgets: false`, do not spread it into your layout; its instances would then reference unregistered widgets.

> The Modular Dashboard is an experimental Payload feature (PR #15700). After installing, run `payload generate:importmap` so the widget's server component resolves in the admin.

### Custom widgets

An app can register its own widgets alongside the built-in ones. Each entry is capability-gated by `requires` and slug-validated; the `analytics-` prefix is reserved for built-ins.

```ts
analytics({
  adapters: [native()],
  widgets: {
    register: [
      {
        slug: 'myapp-top-sources',
        component: '/components/TopSourcesWidget#default',
        label: 'Top sources',
        requires: { dimensions: ['source'] },
      },
    ],
  },
})
```

Build the widget as a server component. Import reads from `@10x-media/analytics/rsc` and chart primitives from `@10x-media/analytics/client`:

```tsx
import { BarList } from '@10x-media/analytics/client'
import { formatMetricValue, readForWidgetBreakdown } from '@10x-media/analytics/rsc'
import type { WidgetServerProps } from 'payload'

export default async function TopSourcesWidget(props: WidgetServerProps) {
  const locale = props.req.i18n.language ?? 'en-US'
  const result = await readForWidgetBreakdown({
    req: props.req,
    metric: 'pageviews',
    dimension: 'source',
    timeframe: 'last30days',
    limit: 5,
    now: new Date(),
  })
  if (result.status !== 'ok') return <span>No data</span>
  return (
    <BarList
      data={result.rows.map((r) => ({
        label: r.label,
        value: r.value,
        display: formatMetricValue('pageviews', r.value, locale),
      }))}
      emptyLabel="No data"
    />
  )
}
```

After registering, run `payload generate:importmap` so the admin can resolve the component. The widget only appears when a configured adapter satisfies its `requires` gate.

## Scheduled cache warming

Surfacing reads are cached in `payload.kv`, keyed per adapter + query and snapped to the UTC day. For a provider-backed dashboard (GA4, Plausible, Umami, PostHog), the first load after a cache entry expires pays a cold provider round-trip. Opt into a background job that pre-runs the dashboard's reads on a cron so that first load is a warm cache hit:

```ts
analytics({
  adapters: [plausible({ /* ... */ })],
  cache: { warm: true }, // default cron: every 30 minutes
})
```

Pass a cron to change the cadence:

```ts
analytics({
  adapters: [/* ... */],
  cache: { warm: { cron: '0 * * * *' } }, // hourly
})
```

The job registers a Payload task (`analytics-warm-cache`) whose work is derived from your `admin.dashboard.defaultLayout`: each metric, trend, and breakdown widget becomes one warm read for the same metric, timeframe, and (in multi-provider setups) data source it renders. The realtime widget is skipped (its short-lived count is kept warm by the live poller), as is any custom widget whose read shape the plugin does not know. One provider failure is logged and does not abort the rest.

Warming is **off by default** because it spends provider API quota on a schedule. It pays off most when the dashboard is provider-backed; the native engine is fast enough that warming it is harmless but low value. The task runs through Payload's jobs runner, so your app must have that runner enabled (cron `autoRun`, or an external scheduler invoking the queue) for the schedule to fire.

## Provider adapters

Third-party providers implement the same `AnalyticsAdapter` contract and ship as code-split subpaths, so a site installs only what it uses.

### Plausible

```ts
import { plausible } from '@10x-media/analytics/adapters/plausible'

analytics({ adapters: [plausible({ siteId: 'example.com', apiKey: process.env.PLAUSIBLE_API_KEY! })] })
```

Uses the Stats API v2 (`POST /api/v2/query`). Pass `host` for a self-hosted Community Edition instance. Supported metrics: pageviews, visitors, visits, sessions, bounceRate, avgDuration, events, scrollDepth, revenue. Durations are normalized to milliseconds.

### Umami

```ts
import { umami } from '@10x-media/analytics/adapters/umami'

// Umami Cloud
analytics({ adapters: [umami({ websiteId: 'xxxx', apiKey: process.env.UMAMI_API_KEY! })] })

// Self-hosted (token from POST /api/auth/login)
analytics({ adapters: [umami({ websiteId: 'xxxx', token: process.env.UMAMI_TOKEN!, host: 'https://analytics.example.com/api' })] })
```

Supported metrics: pageviews, visitors, visits, sessions, bounceRate (derived), avgDuration (derived). A `page` dimension breakdown maps to Umami's `/metrics?type=url`.

### GA4

```ts
import { ga4 } from '@10x-media/analytics/adapters/ga4'

analytics({
  adapters: [
    ga4({
      propertyId: '123456789',
      credentials: {
        client_email: process.env.GA4_CLIENT_EMAIL!,
        private_key: process.env.GA4_PRIVATE_KEY!,
      },
    }),
  ],
})
```

Uses the GA4 Data API (`runReport`) via the official `@google-analytics/data` SDK, declared as an **optional peer dependency** and loaded lazily, so only GA4 sites install it (`pnpm add @google-analytics/data`). Supported metrics: pageviews, visitors, visits, sessions, bounceRate, avgDuration, events, conversions, revenue. Durations are normalized to milliseconds and bounce rate to a percentage. GA4 bills a token quota, so the adapter recommends a long cache TTL.

### PostHog

```ts
import { posthog } from '@10x-media/analytics/adapters/posthog'

analytics({
  adapters: [
    posthog({ projectId: '123', apiKey: process.env.POSTHOG_API_KEY! }),
  ],
})
```

Derives web metrics with HogQL through the Query API. Pass `host` for EU Cloud (`https://eu.posthog.com`) or a self-hosted instance; US Cloud is the default. The API key is a personal API key with the "Query Read" scope. Supported metrics: pageviews, visitors, visits, sessions. A `page` dimension returns a top-pages breakdown.

All provider adapters auto-disable any surface whose required metric they do not provide, and degrade to an empty state when unconfigured (no network calls).
