---
'@10x-media/form-builder': patch
---

The admin builds on Payload `4.0.0-beta.10`: the condition, calculation, flow, field name and recipient pickers read the form through `getDataFromFormState`, which replaced `reduceFieldsToValues` in `payload/shared`.
