---
"@10x-media/fields": minor
---

Add `protection: 'writeOnly'` to `encryptedField`: a mode for credentials that are written and used server-side but never returned to any API caller. Read results (REST, GraphQL, Local API) omit the field entirely; a virtual `<name>_set` sibling exposes set-ness only. The admin renders one always-editable input at native height: a stored value is only a placeholder, typing stages a replacement, an isClearable-style `×` clears (with undo), and `clearable`/`required` govern the `×`. `queryable` and `richText` are rejected on write-only fields.

Two write-only companions: `hint` stores an identification slice (`sk_l····9d3f`) beside the ciphertext at seal time, shown in the admin, list cells, and API responses as `<name>_hint`, capped and length-guarded so it can identify a key but never reconstruct a short secret. `generate` adds a crypto-random generate/rotate action (default 32-char base62, configurable length/prefix/charset) whose value is visible and copyable exactly until the save succeeds, the GitHub-token reveal-once model.

New server-side helpers `readEncryptedField` and `decryptFieldValue` make reading a stored secret a deliberate act: fetch a handle with cacheable ciphertext and on-demand `decrypt()`, or decrypt a cached wire string given only the field path. Both work on every encrypted field, collections and globals, with locale support.

The response strip now also covers globals, closing a gap where a global's encrypted richText ciphertext sibling (and blind-index hashes) surfaced in read results. Boot key validation now scans globals too.
