---
"@10x-media/webhooks": minor
---

Security and behavior fixes for the webhooks plugin:

- **Header precedence**: plugin identity headers (`X-Webhook-Id`, `X-Webhook-Event`, `X-Webhook-Timestamp`) now always win over custom subscription headers with the same name.
- **SSRF guard**: outbound `fetch` now sets `redirect: 'error'` to prevent redirect-following to internal addresses.
- **Inline failure status**: a single inline delivery failure now records `status: failed` instead of `dead` (`dead` is reserved for exhausted retries in queue mode).
- **Audit log protection**: delivery records can no longer be deleted by any authenticated user; `delete` access is now locked to `() => false`.
- **Transform applied to `previousData`**: when `includePreviousData: true` and a `transform` is configured, the transform is now applied to `previousDoc` before it is included as `previousData`, preventing PII bypass.
- **Subscription scan**: the DB query now filters by event and sorts by `createdAt` so the 1,000-subscription cap only applies to matching rows and truncation is deterministic.
- **Redeliver to stored endpoint**: inline redeliver and queue-mode delivery now use the endpoint URL stored at delivery time, not the live subscription URL.
- **Redeliver disabled check**: redelivering a delivery for a disabled subscription now immediately marks the new row `dead` with `error: subscription disabled`.
- **`__none__` rejection**: saving a subscription with `events: ['__none__']` is now rejected via a `beforeChange` hook.
- **Transform suppression**: returning `undefined` from `transform` now suppresses delivery creation entirely for that subscription.
- **Per-subscription error isolation**: a DB or queue error for one subscription no longer aborts delivery for the remaining subscriptions.
- **Toast copy**: the redeliver success toast now reads "Redelivery initiated" (neutral) instead of "Redelivery queued".
- **`redeliverAccess` option** (new): `WebhooksPluginOptions` now accepts `redeliverAccess?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>` to restrict the redeliver endpoint beyond the default "any logged-in user" gate.
- **Docs**: receiver verification example updated to use `timingSafeEqual`; new replay-protection section covering the timestamp staleness window.
