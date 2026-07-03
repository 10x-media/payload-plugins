---
'@10x-media/form-builder': minor
---

Improve TypeScript ergonomics when passing Payload-fetched forms to `<Form>`:

- Adds `toFormDocument(form)` helper (exported from `/react`) that bridges the structural mismatch between Payload's generated collection types and `FormDocument` without an unsafe cast
- Exports `FormFieldInstance` from both `/react` and `/types` subpaths
- Adds `typescriptSchema` to the `flow` JSON field so Payload generates a `FormFlow`-shaped type instead of opaque `unknown`
