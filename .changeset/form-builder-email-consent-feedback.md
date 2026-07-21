---
"@10x-media/form-builder": minor
---

Email actions and consent polish, plus paddle-worldwide handoff asks.

- **New creatable multi-recipient email field.** To, Reply-to, CC, and BCC on the Email Team and
  Confirmation actions accept multiple recipients as native badges, mixing picked department
  addresses, free-typed emails, and `{{field}}` recipient tokens (drag-reorderable, `admin.width`
  aware). Configurable via `email.recipients` (`allowCustom`, `fieldTokens`, `tokenFieldTypes`).
- **Half-width pairing** of the email address fields (To/Reply-to, CC/BCC).
- **Consent field polish:** no more redundant description (the source statement is the content); the
  field block title and the source array rows now show the consent source's name; the condensed
  department-emails array centers its remove control on the input.
- **Consent statements on every read.** An `afterRead` hook resolves statements onto the form doc, so
  consent renders wherever the form is fetched (modal/client, not only RSC); `toFormDocument` falls
  back to the doc-carried statements.
- **`toFormDocument`** accepts a populated redirect `reference` (`value: string | number | object |
  null`) and an optional `resolveRedirect` seam that fills `redirect.url`.
- **Versioned consent proof.** Submissions snapshot the agreed wording via `consent.snapshot`
  (default `both`: a statement hash, the plain text, and the source name), for an audit trail
  independent of later source edits.
- **File MIME picker** constrained to the host upload collection's `mimeTypes` (with an optional
  `uploads.mimeTypes` override).

**BREAKING:** `emailTeam`/`confirmation` `to`, `cc`, `bcc`, and `replyTo` are now `string[]` (`text`
`hasMany`). A legacy single-string value reads as one recipient; Postgres consumers regenerate a
migration.
