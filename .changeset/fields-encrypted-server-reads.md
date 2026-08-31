---
"@10x-media/fields": minor
---

`readEncryptedField` now takes a `req`. Given one, the read joins that request's transaction and locale, so a secret written earlier in the same operation is visible to the code that needs it; without one the read still runs on its own request, outside any transaction in progress. The request is restored exactly as it was handed over.

New `withRawEncrypted(req, read)` for recovering an encrypted field across many rows. `readEncryptedField` issues one query per document, which is the wrong shape for a hook or a job that needs the same secret on every row a query returns, and the rest of each row with it. Inside the window the write-only response strip and the decrypt-on-read step both stand down, so the caller's own `find` returns each encrypted field as its stored wire string for `decryptFieldValue`. The previous mode is restored on the way out, so windows nest, and the request's dataloader is isolated for the duration: its cache key does not include the context, so a related document pulled in at `depth > 0` would otherwise be cached as ciphertext and served that way to an ordinary read later in the same request.

`CorruptPlaintextError` is now exported alongside the other decrypt failures, so a caller can tell authenticated-but-corrupt data (non-retryable) from a wrong key or a malformed wire string.

Encrypted field scans are cached per schema. `decryptFieldValue` walks the field tree to find its marker, so decrypting a page of rows used to repeat that walk once per row.
