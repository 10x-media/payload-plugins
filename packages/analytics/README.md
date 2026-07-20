# @10x-media/analytics

Adapter-based analytics for Payload v3. One adapter contract covers a self-hosted native engine and the major providers (GA4, Plausible, Umami, PostHog), surfaced through dashboard widgets and per-document stat fields, with cached reads, an opt-in sync tier, and capability gating so unsupported surfaces never appear.

[![npm](https://img.shields.io/npm/v/@10x-media/analytics?style=flat-square)](https://www.npmjs.com/package/@10x-media/analytics)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **One adapter contract** with a capabilities model; adapters ship as code-split subpaths (`@10x-media/analytics/adapters/*`) plus a `memoryAdapter` for tests.
- **Native engine**: self-hosted, cookieless analytics in your own database, with atomic rollups, exact daily uniques, geo resolution (platform headers or MaxMind), retention pruning, and opt-in write batching.
- **Dashboard widgets** for Payload's Modular Dashboard: metric, trend, four breakdowns, and realtime, all capability-gated, plus a public API for custom widgets.
- **Display fields**: `analyticsStat`, `analyticsStatRow`, `analyticsFields`, `analyticsTab`, `analyticsTabsField` place per-document stats on your collections; typed per-collection bindings resolve each document's URL path.
- **Caching** through `payload.kv` with request coalescing, plus an opt-in scheduled warm job.
- **Sync tier**: persist provider daily metrics into a queryable Payload collection.
- **Typed translations** with per-key overrides via `@10x-media/analytics/i18n`.

Optional peer dependencies, installed only if used: `@google-analytics/data` (GA4), `maxmind` (MaxMind geo).

## Quick start

```bash
pnpm add @10x-media/analytics
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { analytics, analyticsDefaultWidgets } from '@10x-media/analytics'
import { native } from '@10x-media/analytics/adapters/native'

export default buildConfig({
  admin: {
    dashboard: { defaultLayout: [...analyticsDefaultWidgets()] },
  },
  plugins: [
    analytics({
      adapters: [native()],
      collections: {
        pages: { path: (doc) => (doc.slug ? `/${doc.slug}` : null) },
      },
    }),
  ],
})
```

Run `payload generate:importmap`, send pageviews to `POST /api/analytics/ingest`, and the dashboard fills in.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/analytics):

- [Overview](https://docs.10xmedia.de/analytics)
- [Quick start](https://docs.10xmedia.de/analytics/quick-start)
- [Adapters](https://docs.10xmedia.de/analytics/adapters)
- [Native engine](https://docs.10xmedia.de/analytics/native)
- [Geo resolution](https://docs.10xmedia.de/analytics/geo)
- [Display fields](https://docs.10xmedia.de/analytics/display-fields)
- [Dashboard widgets](https://docs.10xmedia.de/analytics/widgets)
- [Caching and warming](https://docs.10xmedia.de/analytics/cache)
- [Reporting timezone](https://docs.10xmedia.de/analytics/timezone)
- [Sync tier](https://docs.10xmedia.de/analytics/sync)
- [i18n](https://docs.10xmedia.de/analytics/i18n)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
