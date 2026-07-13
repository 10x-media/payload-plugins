---
'@10x-media/webhooks': patch
---

Redelivered delivery rows now store the subscription's current URL as `endpoint` instead of the stale URL captured on the original delivery. The subscription is resolved before the new row is created (in both queue and inline modes), so `endpoint` reflects where the retry actually targets. Missing and disabled subscriptions still dead-row without sending; a missing subscription falls back to the original endpoint, while a disabled one stores its live URL.
