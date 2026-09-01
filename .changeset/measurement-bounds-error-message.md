---
"@10x-media/fields": patch
---

Fix `measurementField()` showing Payload's raw storage-unit validation message ("9.07 is less than the min allowed Value of 30") instead of a unit-aware one when a value falls outside `min`/`max` in the currently displayed unit. The field now always renders its own converted message (for example "Must be at least 66 lb"), independent of Payload's server-driven form-state refresh that can otherwise race the field's own client validation.
