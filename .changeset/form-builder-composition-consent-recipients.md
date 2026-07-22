---
"@10x-media/form-builder": minor
---

Composition seam, consent re-entrance safety, and server-side recipient enforcement.

- **`<FormFields>` + `<Form header>`.** The standard field loop is now an exported `<FormFields>`
  component, so a custom `children` layout can compose `<Form><FormSteps /><FormFields />
  <FormControls /></Form>` without reimplementing visibility, calc, recall, and step filtering. For
  the common case, `<Form header={<FormSteps />} />` places chrome above the fields while keeping all
  default behavior. `recall` is now available on the form context.
- **Consent resolver receives the whole form document.** A multi-tenant `consent.sources` resolver
  derives its tenant from a field on the provided doc instead of reading the form back. The consent
  `afterRead` hook now guards against resolver re-entrance (a per-id `Set` on `req.context`), so a
  resolver that does read the form back can no longer recurse.
- **`email.recipients.allowCustom: false` is enforced on the server.** When set, a non-token
  recipient must be one of the resolved department options, validated at save and fail-closed
  (mirroring the `from` field). The default (`allowCustom` true) is unchanged.
