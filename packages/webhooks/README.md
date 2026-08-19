![Banner](./assets/banner.jpg)

# @10x-media/webhooks

Outbound webhook subscriptions for Payload v3. Opt collections in, let subscribers register URLs in the admin panel (or in code), and deliver signed HTTP POSTs on every create, update, and delete, inline or through Payload's jobs queue, with retries and an append-only delivery log.

[![npm](https://img.shields.io/npm/v/@10x-media/webhooks?style=flat-square)](https://www.npmjs.com/package/@10x-media/webhooks)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Features

- **Opt-in collections** with per-collection operations, `previousData` on updates, and a `transform` to reshape or redact payloads.
- **Two subscription sources**: admin-managed records and hard-coded code subscriptions, merged at delivery time.
- **Delivery modes**: queued through Payload jobs (retries, timeouts) or inline; `auto` detects whether a runner exists.
- **HMAC-SHA256 signing** with reveal-once secrets and id/event/timestamp headers on every request.
- **Delivery log** with status, response code, duration, the exact body sent, and one-click redelivery.
- **Jobs family interop**: installing `@10x-media/jobs` switches delivery to the queue automatically.
- **Typed translations** with per-key overrides via `@10x-media/webhooks/i18n`.

## Quick start

```bash
pnpm add @10x-media/webhooks
```

```ts
// payload.config.ts
import { buildConfig } from 'payload'
import { webhooks } from '@10x-media/webhooks'

export default buildConfig({
  plugins: [
    webhooks({
      collections: {
        posts: true,
        orders: { operations: ['create', 'delete'] },
      },
    }),
  ],
})
```

Then create a subscription in the admin (**Webhooks** group), copy its reveal-once secret to your receiver, and write to an opted-in collection.

## Documentation

Full documentation at [docs.10xmedia.de](https://docs.10xmedia.de/webhooks):

- [Overview](https://docs.10xmedia.de/webhooks)
- [Quick start](https://docs.10xmedia.de/webhooks/quick-start)
- [Subscriptions](https://docs.10xmedia.de/webhooks/subscriptions)
- [Deliveries](https://docs.10xmedia.de/webhooks/deliveries)
- [Signing and secrets](https://docs.10xmedia.de/webhooks/signing)
- [Security model](https://docs.10xmedia.de/webhooks/security)
- [i18n](https://docs.10xmedia.de/webhooks/i18n)

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
