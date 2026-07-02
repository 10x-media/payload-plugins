---
"@10x-media/form-builder": patch
---

Add bundled CSS for the condition builder admin UI. The condition row now lays out as a horizontal flex row (field + operator + value + remove), OR groups get a ruled divider badge, and AND labels are styled consistently. The stylesheet is loaded automatically via the `FormConditionField` client component so no user-side import is needed.
