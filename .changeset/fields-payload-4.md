---
'@10x-media/fields': major
---

Payload 4 support, on Next.js and TanStack Start. Every field now takes the native Payload 4 input look (row height, `--field-*` tokens, borders and focus states) in light and dark mode. Helper fields the factories add are hidden from list columns and filters through `admin.disabled` instead of `disableListColumn` / `disableListFilter`, and encrypted fields emit `jsonSchema` (Payload 4's name for `typescriptSchema`). Icon-library lookups against an upload collection and the measurement preference read pass `overrideAccess: true`, keeping their Payload 3 behaviour under Payload 4's access-by-default Local API.
