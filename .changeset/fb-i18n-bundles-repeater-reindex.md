---
"@10x-media/form-builder": minor
---

Locale-correct i18n bundles for host fallbacks, and repeater error re-indexing on row removal.

- **Locale bundles are exported for host translators.** `@10x-media/form-builder/react` and `/i18n` now export `de`, `bundles` (`Record<string, TranslationBundle>`), the `TranslationBundle` type, and `clientRuntimeKeys`. `makeTranslate` also accepts a locale code (`makeTranslate('de')`) in addition to a map, so a host bridging its own translator can fall back with `makeTranslate(locale)` (or `makeTranslate(bundles[locale] ?? en)`) and a visitor's locale no longer silently resolves to English for a key the host did not mirror. `clientRuntimeKeys` lists the keys the visitor runtime resolves, for asserting mirror coverage in a test.
- **Removing a repeater row re-indexes its sub-field errors.** Deleting a row now clears that row's composite validation errors and shifts the surviving rows' errors down, so a server-side error (for example `crew[2].paddlerName`) no longer mis-attributes to a shifted row or lingers unreachably after a delete.
