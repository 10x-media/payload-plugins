---
"@10x-media/form-builder": patch
---

Repeater correctness fixes.

- Multi-step forms now validate a step's repeater sub-fields on **Next**, so an invalid required sub-field can no longer be skipped past; it surfaces inline, mirroring submit and the server. `goNext` also gains a re-entrancy guard so a double-click cannot push the same step onto history twice.
- Editing a repeater sub-field clears its stale server-side error immediately, instead of leaving it shown until the next submit.
- Repeater rows carry a stable React key, so removing a middle row no longer strands a stateful sub-renderer's local state (e.g. the file renderer's filename) onto the wrong row.
