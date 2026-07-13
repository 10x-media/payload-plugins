---
'@10x-media/form-builder': minor
---

Add a visual flow builder to the `forms` collection. The previously headless `flow` field now has an admin authoring UI: add, reorder, insert, and remove steps; assign fields per step; and set a default next step plus ordered conditional transitions built with the same condition builder used for field visibility. A flow that collapses to fewer than two valid steps is now rejected with a clear validation error on save instead of being silently discarded.
