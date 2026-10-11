---
"@10x-media/form-builder": minor
---

The submission locale gets its own `submissionLocale` prop.

- **Breaking (behavioral): `<Form>`'s `locale` prop is no longer sent with the submission.** The previous beta sent it as `?locale=`, so every host passing `locale` (as the i18n docs teach) had its submissions and emails switch to the visitor's language on upgrade, and a formatting tag like `en-US` silently fell back to the default locale because it is not a content locale code. `locale` is back to formatting and renderer strings only. To store the submission in the visitor's content locale and render its emails in it, pass `submissionLocale` (one of your `localization` codes); a custom `onSubmit` receives it as `locale`. `<Poll>` also sends it with the results request, so option labels in the results match the form.
- **`createSubmission` takes `locale`**, the server-side counterpart of `submissionLocale`, clamped the same way.
- **`fetchFormResults` takes `locale`**, and the results endpoint serves option labels in the clamped `?locale=`.
- Fixed: without localization, a visitor-supplied `?locale=zh_Hant` was stored as is, and `Intl` throws on the underscore, so a field type's `format` could break the submission's admin view. The locale is now stored as a canonical tag (`zh-Hant`), and anything that is not a valid tag becomes `en`.
- Fixed: creating a submission with your own `req` (`payload.create` or `createSubmission`) no longer rewrites that request's `locale` or `fallbackLocale`. Without localization it stays unset rather than becoming `en`.
- `email.render`'s `EmailRenderArgs` and a recipient source's `RecipientResolveArgs` now both extend a shared, exported `SubmissionContextArgs`, so a field added for one hook no longer joins the other's API.
