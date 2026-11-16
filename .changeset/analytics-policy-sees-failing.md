---
"@10x-media/analytics": minor
---

**Additive: a policy function can ask which own sources fail.** Each of `ownSources` carries `failing()`, which resolves to true while the source counts as failing for `'fallback'`. The statuses are read on its first call, so a function that never asks costs no read.
