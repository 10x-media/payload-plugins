---
'@10x-media/form-builder': minor
---

`<Form>` and `<FormResults>` now default to bundled English strings when no `t` prop is provided, so users without a custom translation setup see real copy instead of raw translation keys. The `en` map and `makeTranslate` helper are exported from the `/react` subpath for building custom translators.
