---
"@10x-media/form-builder": minor
---

Add `email.render`, a hook producing the final html of every `emailTeam` and `confirmation` email from the already serialized body, so a host can wrap emails in a branded, localized layout without re-implementing the rich text pipeline. It receives the serialized `html`, the raw `body`, the interpolated `subject`, the `actionType`, and the submission context (`locale`, `form`, `submissionId`, `values`, `descriptors`, `context`, `payload`, `req`). It runs after `richText.serialize`, so the two compose.
