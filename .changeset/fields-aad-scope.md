---
"@10x-media/fields": minor
---

New `aadScope` option on `encryptedField` pins the first component of the ciphertext's AAD binding, which otherwise is the collection or global slug. The slug is the right binding until it can change: a plugin-owned collection whose slug the consumer configures, or a collection renamed with its data kept in place, turns every stored value into an authentication failure that no utility can recover, because reads resolve the binding from the current slug too. A pinned scope survives the rename.

The scope flows through every construction site (sealing, document reads, `decryptFieldValue`, `readEncryptedField`, key rotation, the removal utility), must not contain `.` (the AAD component separator; rejected at the factory), and should be unique per logical schema. Decide it before data exists: changing it later is the re-keying event it exists to prevent.
