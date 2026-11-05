---
"@10x-media/analytics": minor
---

**Revenue: money is opt-in, sales and refunds have calls of their own, and an order counts once.** `purchase` and `refund` are the revenue calls, in the browser and on the server; a sale the browser and a payment webhook both record counts once, in the visit that made it; and only server code can subtract money ([Revenue](https://docs.10xmedia.de/analytics/revenue)).

**Upgrade actions**

1. If the install reports revenue, set `revenue: true`, or `revenue: { currency: 'EUR' }` to report in one currency per install or per scope.
2. If an amount the browser sends should win over a goal's fixed value, as before, set `revenue: { browserAmounts: 'trust' }`.
3. Give a currency to every goal that has an amount: a goal saved earlier with an amount and no currency asks for one on its next save. Where the form-builder goal action's fields are out of the plugin's reach, pass `trackGoalAction({ defaultCurrency })`.
4. Fix an invalid Plausible `revenueCurrency`, which now throws when the adapter is built.
5. Code that implements `Tracker` itself, such as a test double, adds `purchase` and `refund`.
6. To record sales and refunds, call `purchase()` with each order's real id and the server's `refund()` with a `refundId` of its own.

**Breaking:** money is off unless `revenue` is set. Without it the `revenue` metric is gone from every source, the `currency` dimension is not declared and every amount field is hidden (in collections, globals and blocks alike); stored amounts are kept, and turning money on shows them again. The boot warns when a config goal carries a `value` while money is off ([What disappears when money is off](https://docs.10xmedia.de/analytics/revenue#what-disappears-when-money-is-off)).

**Breaking:** `revenue.browserAmounts` defaults to `'fixed'`: a goal's fixed value wins over an amount the browser sends, which counts only for a goal without one. `'none'` ignores browser amounts and `value.prop` alike, `'trust'` keeps the old order. Server code is always believed ([Amounts from the browser](https://docs.10xmedia.de/analytics/revenue#amounts-from-the-browser)).

**Breaking:** ingest refuses a body carrying `revenue` or a negative `value` with a `400`, where 1.0.0-beta.11 ignored the one and dropped the negative amount, keeping the event: only server code subtracts money.

**Breaking:** a goal with an amount needs a currency, in the goals collection and in the form-builder goal action, through the API as much as in the admin; `trackGoalAction({ defaultCurrency })` fills it in where the action's fields are out of the plugin's reach.

**Breaking:** an invalid Plausible `revenueCurrency` throws when the adapter is built, and a blank one no longer turns Plausible's revenue on.

**Breaking:** `Tracker` and `AnalyticsCommands` gain the required `purchase` and `refund`, so code that implements either itself adds them.

**Behavioral:** each goal an event completes carries its own amount, converted from that goal's own currency. Every amount is capped at 10^12.

**Behavioral:** a built-in `purchase` goal exists without being declared, so a sale reaches `conversions` and `revenue` before anyone declares a goal. It is latent: left out of the goal picker and the tracker config, shown in the goals table only once it has conversions, returned by the goals endpoint only for `?include=builtin`, and named in the query endpoint's `builtinGoalSlugs`. `goals.purchase: false` removes it ([The built-in purchase goal](https://docs.10xmedia.de/analytics/goals#the-built-in-purchase-goal)).

**Behavioral:** without a reporting currency, a native read whose revenue adds several currencies lists them in `meta.mixedCurrencies`, and every surface says so; the `currency` dimension, on by default without `revenue.convert`, shows gross per currency.

**Additive:** `purchase({ orderId, value, currency?, items?, props? })` and `refund(...)` as server functions taking `payload`, and `purchase` on the tracker and on `useAnalytics()`; the tracker's `refund` only warns in development, since a refund is recorded server-side, from the payment webhook. `items` are the lines of a sale, forwarded to GA4 as `items` and to PostHog as a property. Server calls filed without a `path` go under `/orders`.

**Additive:** order ids. An id holds up to 255 characters and no control character: the server calls throw `AnalyticsTrackError` for one that is not, and ingest drops a beacon carrying one, still answering `202`. Native stores only a digest of it, keyed by the Payload secret, never the id itself. A sale recorded by both the browser and the webhook counts on the browser's record, in its visit, with the webhook's amount, and the webhook's record counts no event, so a visit's source, campaign and country carry the sale and `events` counts it once. The two pair only within 24 hours, unless `revenue.orderSignature: 'required'` is set and the page sends an id from `signOrderId`; a record arriving after its day was counted has that day counted again ([Recorded in the browser and by the webhook](https://docs.10xmedia.de/analytics/revenue#recorded-in-the-browser-and-by-the-webhook)). A refund counts its amount in revenue and no conversion, is keyed by its `refundId` so two partial refunds both count and a retried one counts once, and is filed with its sale's attribution ([Refunds](https://docs.10xmedia.de/analytics/revenue#refunds)).

**Additive:** `revenue.currency`, `convert`, `dimension`, `browserAmounts` and `orderSignature`, with a vendor's own revenue currency (GA4's property currency, Plausible's `revenueCurrency`) winning over `revenue.currency` for that vendor, and a `revenue.convert` answer that is unbounded or flips the sign counting as no answer; `signOrderId`; a goal's `browser: false`, which ignores completions sent from a browser; `identity` on server calls, `'none'` recording an event as no visitor's; the goal amount control with a currency picker; `analyticsLinkFields({ value: true })` for a per-link amount.
