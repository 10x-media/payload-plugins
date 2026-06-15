---
'@10x-media/form-builder': minor
---

Adds a shadcn registry block (`form`) and bring-your-own-styling documentation.

- **shadcn registry**: `npx shadcn@latest add <registry-url>/r/form.json` installs the shadcn `input`/`textarea`/`label` primitives, six styled field renderers, a `shadcnRenderers` map, and `<FormBuilderForm>` into the consumer's codebase. Consumers own and restyle the copied files.
- **`<FormBuilderForm>`**: `<Form>` preconfigured with the shadcn-styled renderers; consumer `renderers` overrides merge on top.
- **BYO-styling docs**: three paths documented -- CSS-only on the unstyled primitive class hooks (`fb-field`, `fb-field__label`, `fb-input`, `fb-textarea`, `fb-select`, `fb-checkbox`, `data-invalid`, etc.), custom renderers via `defineFieldRenderer` + `resolveRenderers`, and hook-level control via `useField`/`useFormState`.
- **A11y checklist**: documents the label association, `aria-invalid`, `aria-describedby`, `role=alert`/`aria-atomic`, and `required` requirements any custom renderer must satisfy.
