---
"@10x-media/analytics": minor
---

**Breaking:** tenant-safe provider store. The `analytics-providers` collection now has scope-aware default access (a tenant only sees and manages their own provider documents; unscoped installs are unchanged), stamps the document scope server-side, requires a `name`, and stores credentials encrypted at rest via `@10x-media/fields` (write-only: secrets never leave the server; a short hint identifies the stored key). `@10x-media/fields` is a new optional peer dependency, required when `providers.collection` is enabled. The secret masking flow (`__redacted__` round-trip) is gone. Existing plaintext credentials keep working and seal on next save; bulk-encrypt with `encryptExistingData` from `@10x-media/fields/encrypted`.
