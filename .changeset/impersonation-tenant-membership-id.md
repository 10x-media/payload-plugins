---
'@10x-media/impersonation': patch
---

Swap expires the tenant selector instead of writing the target's tenant. The impersonator's selector is still restored on exit. Parallel leaves every `clearOnSwitch` cookie in place.
