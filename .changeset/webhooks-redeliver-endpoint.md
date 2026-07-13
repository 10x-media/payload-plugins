---
'@10x-media/webhooks': patch
---

Redelivered delivery rows now store the subscription's current URL as `endpoint` instead of the stale URL captured on the original delivery. The subscription is resolved before the new row is created (in both queue and inline modes), so `endpoint` reflects where the retry actually targets; missing/disabled subscriptions still fall back to the original endpoint and dead-row without sending.
