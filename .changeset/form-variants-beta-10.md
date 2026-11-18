---
'@10x-media/form-variants': patch
---

The variant form saves the way Payload `4.0.0-beta.10`'s edit view does: the form refreshes its own state after a save and on each change, and locks and stale data come from the document info. A save whose form was reset or left before it returned no longer redirects, switches variant or runs `afterSave`.
