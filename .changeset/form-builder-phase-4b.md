---
'@10x-media/form-builder': minor
---

Headless `<Form>` controller: form state, hooks, progressive validation, conditional visibility, submission pipeline, and lifecycle events.

- **`<Form>`**: orchestrates state, progressive client-side validation (on blur, re-validates on change once touched, all visible fields on submit), conditional field visibility reusing the Phase 3 engine, and a built-in fetch transport to `{apiRoute}/form-submissions`.
- **`useFormState` / `useField`**: context hooks for fully custom layouts; `useField(name)` surfaces value, errors, warnings, touched, setValue, and onBlur for one field.
- **Server-error mapping**: 400 Payload `ValidationError` responses are unpacked and mapped back to individual fields after submission.
- **`onSubmit` override**: replace the built-in transport with any async handler returning `SubmitFormResult`.
- **Lifecycle events** via `FormEventSink`: `form.viewed`, `form.started`, `field.errored`, `submission.created`, `form.abandoned`.
- All new names exported from `@10x-media/form-builder/react`.
