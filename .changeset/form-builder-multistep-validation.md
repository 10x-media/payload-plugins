---
"@10x-media/form-builder": minor
---

Multi-step keyboard, per-step validation reveal, and focus/accessibility fixes for the `<Form>` runtime.

- **Enter advances a multi-step form.** On a non-terminal step, Enter in a single-line field now validates and advances the step (exactly like the Next control), or keeps the visitor on the step and reveals its errors when a field is invalid, instead of doing nothing. On the terminal step Enter submits once (native submit, still behind the existing re-entrancy guard). Textareas (newline), selects (confirm), and buttons stay exempt, and single-step forms keep native Enter-to-submit.
- **Validation errors reveal per step, not globally.** A field's error now shows only once it is touched or a submit/advance attempt was made for the step it belongs to. Previously any submit attempt flipped one global flag, so navigating forward to a later step surfaced errors on fields the visitor had never reached. Internally `FormState.submitAttempted` becomes `attemptedSteps`, and reveal is keyed to each field's step.
- **A terminal Submit routes to the first invalid step.** When an earlier step is invalid at submit time (for example a field that becomes required only after a later answer), the form navigates back to the first step that owns an invalid field and focuses it, rather than failing in place on the terminal step.
- **Focus moves with the step.** Every step change (forward or back) moves focus into the new step, and a blocked advance or submit moves focus to the first invalid field, so keyboard and screen-reader users travel with the form.
- **Step changes and validation failures are announced.** A polite `aria-live` region announces "Step X of Y" on each change, and a `role="alert"` summary appears when an advance or submit is blocked. New translation keys `form.stepStatus` and `form.stepInvalid` (English and German), overridable through the `translations` option.
