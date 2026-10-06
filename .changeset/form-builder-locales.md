---
'@10x-media/form-builder': minor
---

More built-in locales for the `formBuilder:` strings.

- Added: `es`, `fr`, `id`, `pt`, `ru`, `zh`, `uk`, `ar`, `ko`. Every key is covered in each.
- Each locale is a complete bundle, so `makeTranslate(locale)` resolves the visitor-facing strings too, not just the admin authoring UI. Every bundle is exported by name from `/i18n` and `/react` beside `bundles`.
