---
'@10x-media/form-builder': minor
---

Post-submit action pipeline: built-in email, confirmation, and signed-webhook actions; custom actions via `defineAction`; per-form `actions` blocks authored in the admin; queued as Payload jobs when a runner is present with a bounded inline fallback; errors are isolated per action and never fail the submission; recall templates (`{{field}}`) in subject and body; `payload.sendEmail` for email delivery; HMAC-SHA256 `X-Form-Signature` header for webhook signing; server `submission.created` event emitted to the `events` sink on each completed submission.
