---
'@10x-media/form-builder': patch
---

Fix honeypot false positives caused by Chrome autofill: `DEFAULT_HONEYPOT_FIELD` is renamed from `'confirm_email'` to `'website'` (names containing "email" trigger Chrome's email-address heuristic), and the hidden input now uses `autoComplete="new-password"` which Chrome reliably respects over the commonly ignored `"off"`.
