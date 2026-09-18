---
"@10x-media/form-builder": minor
---

Emails follow the visitor's locale. `<Form>` now sends an explicit `locale` prop with the submission as `?locale=` (and hands it to a custom `onSubmit` as `locale`), so the submission stores the visitor's locale instead of the host's default, and the post-submit actions, the confirmation email included, render its subject and body in it. Without the prop nothing changes. A custom `richText.serialize` also receives that `locale` and the `actionType` rendering the body (`emailTeam`, `confirmation`, or a custom action's type), so an email wrapper can localize its own strings and give the visitor's confirmation a different layout than the team notification.
