# @10x-media/form-builder

## 0.1.0-beta.1

### Minor Changes

- `<Form>` and `<FormResults>` now default to bundled English strings when no `t` prop is provided, so users without a custom translation setup see real copy instead of raw translation keys. The `en` map and `makeTranslate` helper are exported from the `/react` subpath for building custom translators.

- Consent field source config is now context-sensitive: the `source` select is generated dynamically from the live `consentRegistry` (so custom sources appear without code changes), and each source's config fields use `admin.condition` to show only the fields relevant to the currently selected source. Previously all source config fields were visible at once regardless of the selected source type.

- Add a visual flow builder to the `forms` collection. The previously headless `flow` field now has an admin authoring UI: add, reorder, insert, and remove steps; assign fields per step; and set a default next step plus ordered conditional transitions built with the same condition builder used for field visibility. A flow that collapses to fewer than two valid steps is now rejected with a clear validation error on save instead of being silently discarded.

- Add `className` prop to `<Form>`: additional CSS classes are merged onto the root `<form>` element (and the post-submit success node) via the new `cn` utility, which is also exported from the `/react` subpath for use in custom renderers and field components.

- Improve TypeScript ergonomics when passing Payload-fetched forms to `<Form>`:

  - Adds `toFormDocument(form)` helper (exported from `/react`) that bridges the structural mismatch between Payload's generated collection types and `FormDocument` without an unsafe cast
  - Exports `FormFieldInstance` from both `/react` and `/types` subpaths
  - Adds `typescriptSchema` to the `flow` JSON field so Payload generates a `FormFlow`-shaped type instead of opaque `unknown`

- Add a typed `translations` option to every plugin factory and make translation keys a stable public API. Each plugin's `./i18n` subpath now exports the `keys` object, the `TranslationKey` union, and the `TranslationsOption` shape. Overrides are flat and per-locale: values win over the built-in locales key-by-key, locales a plugin does not ship are added whole, and app-level `i18n.translations` still wins over everything.

  ```ts
  import { analytics } from "@10x-media/analytics";
  import { keys } from "@10x-media/analytics/i18n";

  analytics({
    adapters: [nativeAdapter()],
    translations: {
      de: { [keys.pluginName]: "Analytik" },
    },
  });
  ```

  A typo'd key inside `translations` is a compile error.

### Patch Changes

- Polish the condition builder admin UI: bare `<button>` elements are replaced with Payload's `Button` component, the OR/AND separators render as themed labels (`fb-condition-builder__or-label` / `fb-condition-builder__and-label`), and the row layout ships as class-based styles in the bundled `@10x-media/form-builder/styles.css` (using Payload CSS variables for light/dark theming). Import that stylesheet in your admin layout to pick up the builder styling.

- Prevent action secrets from leaking to anonymous callers: the `actions` blocks field (which can contain webhook secrets and email recipients) is now restricted to authenticated reads only. The `forms` collection remains publicly readable so forms can be rendered without authentication. Also introduces a shared `isLoggedIn` access helper used across all form-builder collections.

- Fix honeypot false positives caused by Chrome autofill: `DEFAULT_HONEYPOT_FIELD` is renamed from `'confirm_email'` to `'website'` (names containing "email" trigger Chrome's email-address heuristic), and the hidden input now uses `autoComplete="new-password"` which Chrome reliably respects over the commonly ignored `"off"`.

- Prevent anonymous clients from bypassing post-submit actions via a client-supplied `status: 'partial'`: `validateSubmission` now forces `status` to `'complete'` on every unauthenticated create, and field-level access prevents anonymous REST callers from setting the status field at all. Authenticated callers (admin draft-save flows) may still set `partial`.

- Move `@standard-schema/spec` from devDependencies to dependencies. Its types are part of the public validation API surface, and as a devDependency its declaration file was inlined under `dist/node_modules` instead of resolving from the consumer's install.

- Restructure README: features, quick start, and links into the documentation site at https://docs.10xmedia.de. Long-form documentation moved out of the package README.

- Update README documentation links: the docs site now serves from the domain root, so `docs.10xmedia.de/docs/<plugin>` links became `docs.10xmedia.de/<plugin>`.

- Ship per-file dist output instead of bundled chunks. Bundling merged client components into shared chunks and dropped their 'use client' directives, so Next.js lost the RSC boundary and the admin panel crashed with "useRef only works in Client Components" when rendering components imported through such a chunk (for analytics: every chart-based dashboard widget). Dist now mirrors src one file at a time, directives stay exactly where they were authored, and file names are stable across releases. A repo-level `check:dist` verification (directive parity, no inlined dependencies, exports resolution, publint) now runs in CI so this class of regression cannot ship again.

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
