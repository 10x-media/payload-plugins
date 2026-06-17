---
'@10x-media/form-builder': minor
---

Add answer recall, URL prefill, and hidden context fields (Phase 6c).

**Recall (piping):** `{{ fieldName }}` and `{{ fieldName|fallback }}` tokens in field labels, descriptions, option labels, and the success message resolve against the current form values at render time. Values are formatted via the field type (a select shows its option label, a checkbox Yes/No, a date localized). Token-free text is returned unchanged. `buildRecallResolver` and `interpolate` are exported for use in custom layouts and server components.

**URL prefill:** `valuesFromSearchParams(params, fields, registry, options?)` maps query params to typed initial values for known fields only, coerced by value kind, with unknown and invalid params silently ignored. Pass the result to `<Form initialValues={...}>`. The `options` argument supports `map` (rename params to field names), `allow` (opt-in list), and `deny` (opt-out list). SSR-safe: runs in server components with no `window` access and no hydration mismatch. Prefilled values are never trusted and still validate on submit.

**Hidden context fields:** an Advanced `hidden` toggle on any field renders it invisible to the visitor while still capturing and submitting its value. Pair with prefill to collect `utm_source`, referrer, or other context without showing it in the form. The flag is render-only; the server stores and validates normally.
