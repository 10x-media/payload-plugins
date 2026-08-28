---
"@10x-media/jobs": minor
---

The create form pre-fills `input` from the selected task's or workflow's `inputSchema`: scalars get an empty value of their kind, a `hasMany` field or an array one sample element, a relationship the name of the collection it expects an id from, and groups nest. The placeholder is written only while the field is blank or still holds the previous placeholder, so an edited value survives switching tasks, and clearing the selection empties the field again; existing jobs are not touched. `input.examples` replaces the derived placeholder for a slug with one written by hand. The field renders through `JobInputField`, exported from `@10x-media/jobs/client`; new types `JobInputPlaceholders` and `JobInputExamples`.
