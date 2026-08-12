---
'@10x-media/fields': minor
---

Linked color references carry opacity: `preset:<key>/<alpha>` stores a preset reference at 0-100 percent, and the picker's alpha slider rewrites the suffix instead of flattening the reference to a concrete color. Resolution applies the alpha in the field's configured format on both scheme members, the chip and list cell surface the percentage, `alpha: false` strips suffixes on commit, and the new `parsePresetReference` export (`/color` and `/color/utils`) parses stored references for presentation code.
