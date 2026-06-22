# @10x-media/form-builder

## 0.1.0-beta.0

### Minor Changes

- Initial release of `@10x-media/form-builder`, an end-to-end, headless, fully-extensible forms platform for Payload v3: author, validate, render, collect, aggregate, and act on forms, native to Payload and competitive with hosted tools for embedded use.

  - **Field model.** `defineFormField` defines a field type once and yields its admin authoring, a typed isomorphic `validate`, a localized `format`, and a value kind. Built-in fields: text, textarea, email, number, select, checkbox, date, file, consent, and calculation. Every seam is `false | true | object` overridable.
  - **Validation.** Declarative per-field rules via `defineValidationRule` (min/max length, min/max, pattern, email, url, oneOf, matchesField, notAlreadySubmitted) with custom localized messages and error/warning severity, cross-field and async server-only rules, and a Standard Schema escape hatch, all enforced by one server-authoritative engine.
  - **Conditional logic.** Serializable `Where`-shaped `visibleWhen`/`validateWhen` authored with a native Payload-style builder and enforced server-side; hidden fields never leak into a submission.
  - **Headless renderer.** `@10x-media/form-builder/react`: `<Form>` with progressive client validation, conditional visibility, submission with server-error mapping, and a typed lifecycle event taxonomy; accessible unstyled primitives and built-in renderers; an optional container-query layout grid; a shadcn registry block; and a bring-your-own-renderer contract.
  - **Multi-step flow.** A serializable flow state machine with conditional branching and skipping; non-breaking, since a form with no flow renders as an ordinary single-step form.
  - **Presentations.** Page, modal, drawer, and inline surfaces (plus custom), built from dependency-free, accessible overlay primitives.
  - **Recall, prefill, and calculations.** Pipe earlier answers into later labels and the confirmation screen; prefill from URL parameters; a safe (no-`eval`) expression engine for pricing, quotes, and quiz scoring.
  - **Post-submit pipeline.** Built-in email, confirmation, and signed-webhook actions plus custom actions, run as Payload jobs with a bounded inline fallback, alongside a pluggable lifecycle event sink.
  - **Consent.** A compliant consent field with three sources, published-version capture, and proof by reference.
  - **Polls and aggregation.** A submission-aggregation utility, a headless and shadcn `<FormResults>`, and a `<Poll>` pattern with public results.
  - **File uploads.** A file field backed by a configurable upload collection with server-enforced MIME, size, and required checks, and self-describing references in the submission.
  - **Spam controls.** Honeypot and rate-limiting on by default, a captcha adapter seam, upload-ownership scoping, and privacy-first capture metadata.
  - **Submissions and i18n.** Typed, self-describing, localized submissions with a formatted admin answers view; typed, host-overridable translations that never depend on `@payloadcms/translations`.

  Published under the `beta` dist-tag.
