---
'@10x-media/fields': minor
---

Add `measurementField()`: a number field storing a canonical value in one storage unit while each admin edits and reads in their own preferred unit. Eight usages ship built in (body weight, person height, distance, mass, length, volume, temperature, speed), each with a curated set of selectable units, including display-only compound entry (feet and inches, stone and pounds).

- Display unit resolves per viewer: a payload-preferences pick that follows them across devices and flips every field of the same usage at once, then the field's own `defaultUnit`, then the plugin's `fields({ measurement: { defaultUnits } })`, then locale detection from the browser language (vendored CLDR data for US/Liberia and UK/Myanmar imperial units, metric everywhere else), then metric.
- The stored value is a plain number column: native sort, filter, and group-by, and zero-migration adoption on an existing numeric column by matching `storageUnit` to what's already there.
- `min`/`max` are expressed in the storage unit and enforced by Payload's native number validation; the edit view shows bounds converted to the display unit.
- `@10x-media/fields/measurement/utils` exports the conversion and formatting engine (`convert`, `formatMeasurement`, `decompose`/`compose`, `resolveUnitForLocale`, `unitLabel`, `USAGES`, `UNITS`) standalone for frontend use.

Additive: new measurement field family; no changes to existing families or stored data.
