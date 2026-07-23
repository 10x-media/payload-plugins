---
"@10x-media/form-builder": minor
---

Second feedback round: submit control, step field order, response editor, and host-rendered success.

- **Implicit Enter-submit is suppressed on multi-step forms.** A form-level key handler prevents a lone text input from submitting the whole form on Enter; only the explicit Submit control submits. Textareas (newline), selects (confirm), and buttons are exempt, and single-step forms keep native Enter-to-submit. The `<form>` is the plugin's even in `children` mode, so this is the only place a host could apply the guard.
- **Step fields render in `form.fields` order.** A step's `fields` list is treated as membership only; the render order follows the form's field order rather than the flow-builder entry order.
- **`richText.responseEditor`.** The success response message field's editor can now be set independently via `richText.responseEditor` (falling back to `richText.editor`), mirroring `bodyEditor` for action bodies. The message block stays on the plugin-wide `editor`.
- **Host-rendered success.** `onSuccess` gains a second argument, `{ response }`, carrying the recall-resolved success response (a redirect url, or the message serialized with the form's converters), so a host can toast or render it; `<Poll>` forwards the same payload to its host. A new `converters` prop on `<Form>` threads custom block converters (e.g. host `icon`/`badge` blocks) into the client serializer, so those blocks survive in the success message, the resolved response, and inline `message` blocks. `successBehavior: 'reset'` clears the form in place after a successful submit instead of swapping in the success screen (returning a multi-step form to its first step), so a host can keep the form usable and give feedback via `onSuccess`. Defaults (`onSuccess`'s first argument, `successBehavior: 'replace'`) are unchanged. New exported types: `FormSuccessResponse`, `FormSuccessResult`.
