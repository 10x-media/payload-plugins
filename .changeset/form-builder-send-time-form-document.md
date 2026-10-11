---
"@10x-media/form-builder": minor
---

Send-time hooks receive the whole form document. Recipient sources, from sources, `richText.serialize`, `email.render`, and a custom action's `run` used to get `form` as `{ id, title }` only, so a host needing any other field (a multi-tenant host's `tenant`) read the same form again in every hook. `form` is now the document the plugin already loaded for the run, at depth 0 (relationships are ids) and in the submission's locale, typed as the exported `SubmissionForm` (`{ id, title? } & Record<string, unknown>`). `id` and `title` are unchanged, so existing hooks keep working; drop the re-reads and read the field off `form` instead.
