---
'@10x-media/fields': minor
---

`ColorInput` and `MeasurementInput` (`/client`) render the color and measurement rows without a form: controlled `value`/`onChange`, options and presets passed as props, and the same commit, salvage, preset-chip and unit-conversion behavior as the fields, which now wrap them with `useField`. Each reports its own format or bound errors unless the caller passes `error` or `showError`, and `MeasurementInput` defaults `units` and `preferenceKey` from `storageUnit` alone.
