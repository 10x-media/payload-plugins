---
'@10x-media/form-builder': minor
---

Two retention gaps made visible. A non-persisting form that carries a consent field now shows an admin sidebar notice saying the consent proof is discarded with the pruned row, since that combination is only right when the consent record lives elsewhere (a double opt-in provider); it stays a notice, not a save error, because that setup is legitimate. And submissions kept after an essential action failed are now stamped `actionFailed: true` (indexed, read-only), so an operator can filter the accumulated rows, replay the addresses once the provider recovers, and clear them.
