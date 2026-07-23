---
"@10x-media/form-builder": patch
---

Correctness and security hardening from an internal audit.

- **Registry key forced** on custom `actions` and `poll.sources`: a definition registered under a key that differs from its `type` no longer silently never runs.
- **Recipient injection closed**: a resolved `{{field}}` recipient is sanitized to a single address, dropping CR/LF header injection and any extra addresses a crafted submission value could smuggle in.
- **`email.recipients.fieldTokens: false`** is now enforced on the server, not just the client.
- **Consent integrity**: prefill and submit-time boolean coercion share one truthy allow-list, so a stray string value (e.g. from a non-React client) is never read as consent.
- **Cross-tenant leak closed**: the consent-sources and poll-options endpoints load the form under the caller's own read access (no `overrideAccess`), so an authenticated user cannot enumerate another tenant's form.
- **Rate-limit skip surfaced**: when the request identity is null the limiter still fails open, but the skip is recorded on `meta.spam.rateLimit` and warned once instead of being silent.
- **Honeypot collision fixed**: the decoy is submitted under a fixed reserved key, so a real field sharing the decoy's DOM input name (e.g. `website`) is never stripped or mistaken for the honeypot.
- **Action failures logged**: a failed post-submit email or webhook is logged per action instead of being swallowed while the submission looks fully successful.
