---
"@10x-media/form-builder": minor
---

Two new controls for consent reads and upload ownership.

- **`consent.resolveOnRead`** (default `true`) gates the afterRead hook that resolves each form's consent statements on every read. Set it `false` to skip that per-read source lookup (N queries on a list view) and resolve statements yourself with the exported `resolveConsentStatements` when you render a form. Submit-time proof capture is unaffected either way, since it always re-resolves from the source.
- **`spam.uploadOwnership`** (default `'lenient'`) controls how strictly a submitted file's upload ownership is enforced. `'strict'` additionally rejects a stamped upload whenever the submitter cannot be identified, so a deployment that always identifies requests (a trusted proxy header, or a custom `identify`) never lets an unverifiable claim capture an owned upload. `'lenient'` keeps the current fail-open behavior for unidentifiable submitters.
