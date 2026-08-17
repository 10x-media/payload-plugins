---
"@10x-media/fields": minor
---

Add `protection: 'writeOnly'` to `encryptedField`: a mode for credentials that are written and used server-side but never returned to any API caller. Read results (REST, GraphQL, Local API) omit the field entirely; a virtual `<name>_set` sibling exposes set-ness only. The admin renders a write-only editor: dots with a Set badge, Replace (enter a new value without seeing the old one), and Clear with undo. `queryable` and `richText` are rejected on write-only fields.

New server-side helpers `readEncryptedField` and `decryptFieldValue` make reading a stored secret a deliberate act: fetch a handle with cacheable ciphertext and on-demand `decrypt()`, or decrypt a cached wire string given only the field path. Both work on every encrypted field, collections and globals, with locale support.

The response strip now also covers globals, closing a gap where a global's encrypted richText ciphertext sibling (and blind-index hashes) surfaced in read results. Boot key validation now scans globals too.
