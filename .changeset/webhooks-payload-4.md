---
'@10x-media/webhooks': major
---

Payload 4 support, on Next.js and TanStack Start. `next` is no longer a peer. Subscriptions and the delivery log set `versions: false`, as they had no history on Payload 3; the delivery log also sets `authorship: false`, while subscriptions get Payload 4's `createdBy` and `updatedBy`, so SQL installs run a migration. Delivery jobs are queued with `overrideAccess: true`, so a write by someone who may not queue jobs still emits its webhooks. Rotate secret and Redeliver are secondary buttons, the rotated-secret reveal is Payload 4's dialog (still closed only by its acknowledgement), and the status pills use the Payload 4 tokens, Delivered staying green. See Upgrading to Payload 4 in the docs.
