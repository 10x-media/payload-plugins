---
'@10x-media/fields': minor
---

`colorField` presets can carry a light/dark pair, so one linked reference stays mode-responsive wherever it renders.

- `ColorSchemeValue` widens a preset's `value` to `string | { light, dark }`. Flat and scheme presets mix freely in one palette; a pair with one member filled in behaves as that color in both schemes.
- `linked.resolve` chooses the virtual sibling's shape: `'value'` (default) keeps it a text field, `'schemes'` makes it a JSON field carrying the pair. `linked.fallback` accepts a pair too. A field configured before this release is unaffected, and flattens to `light` if its resolver starts returning pairs.
- `presetsFromArray()` builds presets from a repeatable array field, one row per color, with flat or paired value columns.
- `lightDark()` and `isColorSchemeValue()` ship from `./color` and `./color/utils` for rendering and narrowing a resolved value.
- Scheme presets render as a diagonal split swatch in the picker, the chip, and the list cell. A non-linked field stores a scheme preset's `light` member, since a text column holds one color.
- Fixed: a list cell showed no swatch and falsely reported a missing preset whenever the resolved sibling was not a plain string.
