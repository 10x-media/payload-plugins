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
