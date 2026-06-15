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

Registering the adapter adds two hidden collections (`analytics-events` and `analytics-rollups`) and a `POST /api/analytics/ingest` beacon endpoint. Events are written atomically via `$inc` (Mongo) or `ON CONFLICT DO UPDATE` (Postgres), so concurrent ingestion is safe.

Supported metrics: `pageviews`, `events`, `avgDuration`, `visitors`, `sessions`.

The native engine pre-aggregates unique visitors and sessions alongside pageviews. Distinct counts are computed exactly via a dedicated `analytics-seen` ledger and stored at every granularity they are queried (per page, site-wide, and site-wide per country), so they are always read directly and never summed across buckets. A site-wide country breakdown dimension is available out of the box; geoless events are simply omitted from it.

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
