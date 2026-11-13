---
"@10x-media/analytics": minor
---

**Additive: a policy function sees which own sources fail.** Each of `ownSources` carries `failing`, true while the source counts as failing for `'fallback'`, so `({ ownSources }) => ownSources.every((source) => source.failing)` reads the shared source while no own source works.
