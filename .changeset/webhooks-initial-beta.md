---
'@10x-media/webhooks': minor
---

Initial beta of `@10x-media/webhooks`: outbound webhook subscriptions for Payload v3.

- **Subscriptions**: an admin-managed collection for registering endpoint URLs, selecting events, and storing per-subscription secrets. A 48-character hex secret is auto-generated on create.
- **Deliveries log**: an append-only collection with derived status, HTTP response code, and a redeliver button that replays the original payload to the original URL.
- **Event hooks**: opt any collection in with `collections: { posts: true }`. Emits `<slug>.created`, `<slug>.updated`, and `<slug>.deleted` events. Per-collection `operations`, `transform`, and `includePreviousData` options.
- **HMAC signing**: `X-Webhook-Signature: v1=<hex>` on every request when a subscription has a secret. Signed over `${timestamp}.${rawBody}`.
- **Delivery modes**: `inline` (awaited in the hook), `queue` (Payload jobs task with configurable retries and queue), and `auto` (queue when a runner is detected, inline otherwise).
- **Code subscriptions**: hard-coded subscriptions in plugin options, merged with admin-managed ones at delivery time.
- **Composable**: auto-detects `@10x-media/jobs` (uses its worker) and `@10x-media/automations` (registers a `webhook` trigger in the catalog).
- **Cross-DB**: tested on MongoDB and PostgreSQL via the matrix integration suite.
