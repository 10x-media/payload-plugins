---
"@10x-media/webhooks": patch
---

`transform` now also applies to `previousData` on update deliveries, closing a gap where the prior document shipped unredacted when `includePreviousData` and a redacting `transform` were combined. The transform args gain a `target` field (`'data'` or `'previousData'`) naming the slot being built; on the `previousData` call `doc` is the prior document. Existing transforms need no change and now redact both slots.

Redelivery (and queued delivery attempts) short-circuit to a `dead` row when the subscription has been disabled, matching the dispatch path. Docs now state that redelivery targets the subscription's current URL.
