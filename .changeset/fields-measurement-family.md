---
'@10x-media/fields': minor
---

Add `measurementField()`: a number field storing a canonical value in one storage unit while each admin edits and reads in their own preferred unit. Eight presets ship built in (body weight, person height, distance, mass, length, volume, temperature, speed) as spreadable option bundles, or declare `storageUnit`/`units`/`preferenceKey` directly for anything else; units are constrained only by dimension, and generics narrow those options to the storage unit's dimension when it's a literal. Compound entry (feet and inches, stone and pounds) stays display-only.

- Display unit resolves per viewer: a payload-preferences pick keyed by `preferenceKey` (shipped presets keep their own bucket, free-form fields default to the storage unit's dimension) that follows the viewer across devices and flips every field sharing that key at once, then the field's own `fallbackUnit`, then the plugin's `fields({ measurement: { defaultUnits } })`, then the field's `localeDefaults`, then a per-dimension locale-default table (vendored CLDR data for US/Liberia and UK/Myanmar imperial units, metric everywhere else), then the field's first unit.
- Custom units and dimensions: serializable linear or affine unit definitions (`custom: { units, dimensions }`) travel with the field's client props, so a frontend can rebuild the same engine with `createEngine(custom)`. A unit with no `Intl.NumberFormat` identifier (`intlUnit: null`) formats as a plain decimal plus its short label.
- The editable input always shows the shortest draft that round-trips to the exact stored value (faithful drafts); rounding for display only happens in read-only contexts (list cells, `formatMeasurement`).
- The unit affordance is now the value's adjacent chip, doubling as the popup trigger, rather than a separate far-right badge.
- The stored value is a plain number column: native sort, filter, and group-by, and zero-migration adoption on an existing numeric column by matching `storageUnit` to what's already there.
- `min`/`max` are expressed in the storage unit and enforced by Payload's native number validation; the edit view shows bounds converted to the display unit.
- `@10x-media/fields/measurement/utils` exports the conversion and formatting engine (`convert`, `formatMeasurement`, `decompose`/`compose`, `resolveDisplayUnit`, `systemForLocale`, `createEngine`, `unitLabel`, `unitsOfDimension`, `UNITS`) standalone for frontend use.

Additive: new measurement field family; no changes to existing families or stored data.
