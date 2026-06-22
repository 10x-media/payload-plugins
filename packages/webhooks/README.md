# @10x-media/webhooks

Outbound webhook subscriptions for Payload v3. Opt any collection in, let subscribers register URLs in the admin panel, and deliver signed HTTP POSTs on every create/update/delete -- inline or via Payload's built-in jobs queue.

[![npm](https://img.shields.io/npm/v/@10x-media/webhooks?style=flat-square)](https://www.npmjs.com/package/@10x-media/webhooks)

Part of the [@10x-media Payload plugins](https://github.com/10x-media/payload-plugins) collection. In beta: published under the `beta` dist-tag until a stable 1.0.

## Requirements

- Payload v3 (peer: `payload@^3.82.0`)
- React 19 (peer)
- Node 22.18+

## Installation

```bash
pnpm add @10x-media/webhooks
```

## Usage

```ts
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

That is the minimum config. The plugin adds two collections to your admin panel:

- **Webhook Subscriptions** -- admins create endpoint records (URL, events, optional secret).
- **Webhook Deliveries** -- an append-only log with status, response code, and a redeliver button.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `disabled` | `boolean` | `false` | When `true`, returns the config unchanged. |
| `collections` | `Record<string, true \| CollectionWebhookConfig>` | `{}` | Collections that emit webhook events. |
| `subscriptions` | `CodeSubscription[]` | `[]` | Hard-coded subscriptions (no admin record needed). |
| `delivery` | `DeliveryMode \| DeliveryOptions` | `'auto'` | How deliveries are executed. |
| `subscriptionsCollection` | `{ slug?: string; hidden?: boolean }` | -- | Override the subscriptions collection slug or hide it from the admin panel. |
| `deliveriesLog` | `{ slug?: string; hidden?: boolean }` | -- | Override the deliveries collection slug or hide it from the admin panel. |

### `CollectionWebhookConfig`

```ts
type CollectionWebhookConfig = {
  operations?: ('create' | 'update' | 'delete')[]
  includePreviousData?: boolean
  transform?: (args: {
    doc: Record<string, unknown>
    previousDoc?: Record<string, unknown>
    operation: 'create' | 'update' | 'delete'
    req: PayloadRequest
  }) => unknown
}
```

`true` is shorthand for all three operations with no transform.

`transform` lets you redact fields or reshape the payload before it is sent. Return `undefined` to suppress delivery for that document.

`includePreviousData` adds a `previousData` key to the body on `update` events.

### Delivery modes

| Mode | Behavior |
|---|---|
| `'auto'` (default) | Queued when `config.jobs.autoRun` is set or `@10x-media/jobs` is installed; inline otherwise. |
| `'queue'` | Always enqueued as a Payload job. A worker must run `payload.jobs.run()`. |
| `'inline'` | Awaited in the `afterChange`/`afterDelete` hook. Simple but adds latency to every write. |

Pass a full `DeliveryOptions` object to tune the queue and timeout:

```ts
webhooks({
  collections: { posts: true },
  delivery: {
    mode: 'queue',
    timeoutMs: 5_000,
    retries: 3,
    queue: 'webhooks',
  },
})
```

Defaults: `timeoutMs: 10000`, `retries: 4`, `queue: 'default'`.

### Code subscriptions

Register subscriptions in code when you do not want them managed through the admin panel:

```ts
webhooks({
  collections: { orders: true },
  subscriptions: [
    {
      id: 'my-crm',
      url: 'https://crm.example.com/hooks/orders',
      events: ['orders.created', 'orders.updated'],
      secret: process.env.WEBHOOK_SECRET,
    },
  ],
})
```

Code subscriptions are merged with admin-managed ones at delivery time.

## Webhook payload

Every delivery POSTs a JSON body:

```json
{
  "id": "<delivery-id>",
  "event": "posts.created",
  "collection": "posts",
  "operation": "create",
  "occurredAt": "2025-01-01T00:00:00.000Z",
  "data": { ... }
}
```

`previousData` is included on `update` events when `includePreviousData: true`.

## Signature verification

When a subscription has a `secret`, each request carries an `X-Webhook-Signature` header:

```
X-Webhook-Signature: v1=<hex>
```

The signature is HMAC-SHA256 over `${timestamp}.${rawBody}`, where `timestamp` is the Unix second from the `X-Webhook-Timestamp` header.

Verify in your receiver:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  const expectedBuf = Buffer.from(`v1=${expected}`)
  const actualBuf = Buffer.from(signature)
  // timingSafeEqual requires equal lengths; unequal length means mismatch
  if (expectedBuf.length !== actualBuf.length) {
    return false
  }
  return timingSafeEqual(expectedBuf, actualBuf)
}
```

### Replay protection

`X-Webhook-Timestamp` is included in the signed payload, so the signature covers when the request was sent. To prevent replay attacks, add a staleness check before accepting a delivery:

```ts
function isTimestampFresh(timestamp: string, toleranceSeconds = 300): boolean {
  const sent = Number(timestamp)
  if (!Number.isFinite(sent)) return false
  const now = Math.floor(Date.now() / 1000)
  const diff = now - sent
  // Reject replays older than the tolerance window and future-dated requests
  return diff >= 0 && diff <= toleranceSeconds
}
```

Reject the request if `isTimestampFresh(req.headers['x-webhook-timestamp'])` returns `false`. A ±5 minute window (`toleranceSeconds: 300`) is the conventional default.

Additional headers sent on every request: `X-Webhook-Id`, `X-Webhook-Event`, `X-Webhook-Timestamp`, `User-Agent: 10x-media-webhooks`. Subscriptions can inject extra headers via the admin panel's **Headers** array field.

## Admin panel

The plugin adds a **Webhooks** group with two collections.

**Webhook Subscriptions**: create and manage endpoint records. A random 48-character hex secret is auto-generated on create and shown in full **exactly once** on that create response -- copy it to your receiver then. On every later read it is masked (`__redacted__`); the raw value is still used internally to sign deliveries but is never returned through the API or admin again. Rotate by deleting and recreating the record.

**Webhook Deliveries**: an append-only delivery log. Each row shows the event, subscription, status, HTTP response code, and a **Redeliver** button that replays the original payload to the original URL. Access requires a logged-in admin.

## Composing with `@10x-media/jobs`

When `@10x-media/jobs` is installed, `delivery` mode auto-resolves to `'queue'` and the delivery task runs under the jobs worker. No extra config is needed -- the plugin detects the sibling plugin automatically.

## Composing with `@10x-media/automations`

When `@10x-media/automations` is installed, the plugin contributes a `webhook` trigger slug to the automations catalog, reserving it for future inbound-webhook support. This plugin is outbound-only today and does not yet fire that trigger -- the contribution simply registers the slug so a later inbound phase can use it. No extra config is needed.

## Security

- **Signing secrets are reveal-once.** A subscription's secret is shown in full only on the create response and masked (`__redacted__`) on every read thereafter; the raw value is used internally to sign deliveries and is never returned via REST, GraphQL, or the admin again. It is currently stored unencrypted at rest -- encryption-at-rest is planned.
- **Outbound requests target operator-supplied URLs (SSRF).** Deliveries POST to whatever URL a subscription specifies, including private or internal hosts. Subscriptions are created by authenticated admins, so treat that as a trusted operation; if your admins are not fully trusted, restrict outbound egress at the network layer or front your receivers with an allowlist.
- **Admin access is the trust boundary.** Both collections require a logged-in user, and the redeliver endpoint authorizes by login only (any authenticated user may redeliver any delivery). Tighten the collections with your own access control if you need finer-grained permissions.

## License

[MIT](./LICENSE). Copyright 10x Media GmbH.
