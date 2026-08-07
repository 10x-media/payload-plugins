---
'@10x-media/undo-redo': patch
---

Stop polymorphic relationship and upload fields from producing history entries nobody asked for. Payload hands react-select's option objects straight to form state for a `relationTo` array, so the value carries `label` and `allowEdit` next to the reference, and those move on their own: a label refreshes when the related document is saved, `allowEdit` appears once permissions resolve, and the server merge after a save replaces the whole option with the bare reference. The last one appended an entry identical to the one before it, costing an extra undo to get past. Comparison now reduces such values to `relationTo` and `value`, which is the same line Payload's own change detection draws.
