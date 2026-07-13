---
'@10x-media/form-builder': patch
---

Prevent anonymous clients from bypassing post-submit actions via a client-supplied `status: 'partial'`: `validateSubmission` now forces `status` to `'complete'` on every unauthenticated create, and field-level access prevents anonymous REST callers from setting the status field at all. Authenticated callers (admin draft-save flows) may still set `partial`.
