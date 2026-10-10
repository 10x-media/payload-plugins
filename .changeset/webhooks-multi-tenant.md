---
'@10x-media/webhooks': minor
---

Make the plugin safe when subscriptions are created by tenants rather than by trusted operators. One default changed; everything else is opt-in.

- **Breaking: subscription URLs must be `https:` and public.** An admin-managed subscription pointing at `http:`, or at a loopback, private, link-local or otherwise non-public address, is rejected on save, refused at delivery time (`dead`), and refused at the socket: deliveries now go through a dispatcher whose DNS lookup rejects non-public addresses, so a public hostname cannot be re-pointed at an internal one after it was saved. Set `delivery.allowHttp` and `delivery.allowPrivateAddresses` to keep the old behaviour, which local development needs. **Code subscriptions are not affected.**
- **`owner` and `enforceOwnerAccess`.** `owner.resolve` tells the plugin who a subscription acts as. With `enforceOwnerAccess`, a subscription can only list events from collections its owner can read, and on every write the document is re-read through Payload's access control as the owner: no access, no delivery row and nothing sent. What the owner can read, at depth 0 and with their field-level access, is what is sent, and `previousData` is omitted. `owner.canActAs` decides who may assign which owner. It requires explicit `overrides.access` on both plugin collections and fails at startup without them.
- **`collections.<slug>.filter`**: decide per subscription whether a document is delivered. It receives the stored subscription, fields you added included, never its secret. A rejection leaves no delivery row.
- **`collections.<slug>.scope`**: narrow the subscriptions loaded for a document with a `Where`, so a tenanted install reads its own tenant's rows per write.
- **No more 1,000-subscription ceiling.** Subscriptions for an event are paged through instead of scanned up to a cap, and `events` is indexed on MongoDB.
- **Redelivery checks the subscription too.** The caller needs read access to the delivery and to the subscription behind it. A replay keeps the original's owner, and is refused when the subscription has changed owner since. A queued delivery is held to the same rule on every attempt.
- **Delivery rows record `ownerId` and `ownerCollection`** when `owner` is configured.
- **A stored URL that is not an absolute `http(s)` URL is refused as `dead` on the first attempt**, with the reason, instead of failing every retry.
- **New dependencies:** `undici` and `ipaddr.js`, the two libraries Payload's own SSRF-safe fetch is built on. Deliveries are now sent with `undici`'s `fetch` and its own dispatcher, so a test that stubs `globalThis.fetch`, or a process-wide dispatcher set with `setGlobalDispatcher`, no longer sees deliveries to admin-managed subscriptions.
- **Bulk updates and deletes no longer lose deliveries in `inline` mode.** Their documents dispatch concurrently on one request, and a shared window onto the sealed secrets made some of them refuse to send. Subscriptions are now read on a request of their own, outside the write's transaction.

**Action required**

1. If any admin-managed subscription points at `http:` or at an internal address, either move it to a code subscription, or set `delivery.allowHttp` / `delivery.allowPrivateAddresses`. Until then its deliveries are recorded as `dead` with the reason.
2. On a SQL adapter, run a schema migration (`pnpm payload migrate:create`): the subscriptions' events table gains an index on its value column, and, if you configure `owner`, the delivery log gains `owner_id` and `owner_collection`. MongoDB needs nothing.
3. Under `enforceOwnerAccess`, existing subscriptions have no owner and stop delivering until one is assigned.

See [Multi-tenancy](https://docs.10xmedia.de/webhooks/multi-tenancy) and [Security](https://docs.10xmedia.de/webhooks/security#subscription-urls-ssrf).
