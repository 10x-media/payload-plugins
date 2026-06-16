---
'@10x-media/form-builder': minor
---

Add multi-step flow state machine: serializable `FormFlow` graph layered over the flat field list, pure isomorphic engine (`firstStepId`, `resolveNextStepId`, `isTerminalStepId`, `stepFieldNames`), `<Form>` multi-step rendering with per-step validation and conditional branching, and `useFormStep` for custom step UIs and progress indicators. Authored as data; a visual flow builder is a later release.
