---
'@10x-media/form-builder': minor
---

Eight more built-in locales alongside English and German.

- Added: `es`, `fr`, `id`, `pt`, `ru`, `zh`, `uk`, `ar`. Every `formBuilder:` key is covered in each.
- Each is a complete bundle, so `makeTranslate(locale)` resolves the visitor-facing strings too, not just the admin authoring UI. Every bundle is exported by name from `/i18n` and `/react` beside `bundles`.
