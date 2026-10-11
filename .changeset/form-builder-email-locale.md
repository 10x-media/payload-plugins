---
"@10x-media/form-builder": minor
---

Emails follow the visitor's locale. `<Form>` now sends an explicit `locale` prop with the submission as `?locale=` (and hands it to a custom `onSubmit` as `locale`), so the submission stores the visitor's locale instead of the host's default, and the post-submit actions, the confirmation email included, render its subject and body in it. Without the prop nothing changes. The server clamps the visitor-controlled locale before anything reads it: a localized host keeps only its configured locale codes (`all`, `*`, and unknown codes become the default locale), a host without localization keeps any plain language tag and otherwise stores `en`. A custom `richText.serialize` also receives that `locale` and the `actionType` rendering the body (`emailTeam`, `confirmation`, or a custom action's type), so an email wrapper can localize its own strings and give the visitor's confirmation a different layout than the team notification.
