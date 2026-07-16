# @10x-media/form-builder

## 0.1.0-beta.4

### Minor Changes

- Feedback round: flow authoring, localized content, response/display settings, bring-your-own uploads, poll lifecycle, composable form chrome, and a German locale.

  **Breaking:**

  - **Uploads are bring-your-own and off by default.** The plugin no longer registers a `form-uploads` collection. `uploads` is now `false` (default; the `file` field type is removed from the registry entirely) or `{ collection: 'slug' }` pointing at an upload-enabled collection the app owns; the plugin validates it at boot, appends a hidden `owner` field, and prepends the spam upload hooks. The file field's `relationTo` config is gone (the server stamps the configured slug onto each `file` block as a hidden `uploadsCollection`), and `overrides.uploads` no longer exists.
  - **Stored presentation is gone.** The `defaultPresentation` field on `forms` and the plugin-level `presentations` option are removed. Presentation is decided at render time via the `presentation`/`presentations` props on `<Form>`; the React presentation system (page/inline/modal/drawer, custom `FormPresentation`) is unchanged.
  - **Poll config moved into a `poll` group.** The top-level `showResults`/`resultsField` fields on `forms` are replaced by `poll.enabled`, `poll.resultsField`, plus the new `poll.resultsVisibility` and `poll.closesAt`. The results endpoint now gates on `poll.enabled` and visibility.
  - **Content fields are localized by default.** Author-facing content (field labels, placeholders, descriptions, option labels, consent statements, action subjects/bodies, response/display content) carries `localized: true`; on hosts with Payload `localization` configured the stored data shape changes to per-locale objects. Hosts without localization are unaffected (Payload strips the flag). Opt out with `localizeContent: false`; when opting out, derive registry overrides from `buildDefaultFieldDefinitions(false)` / `buildDefaultActionDefinitions(false)` / `buildDefaultConsentSources(false)` instead of spreading the prebuilt defaults, which carry the localized flags.
  - **`<Poll hasVoted>` ORs with the localStorage guard.** `hasVoted: true` marks the visitor as voted regardless of localStorage; it previously could suppress the localStorage read. `false`/omitted falls back to localStorage as before.
  - **Form chrome markup changed.** The default buttons now carry stable classes (`fb-form__back`, `fb-form__next`, `fb-form__submit`) and always render inside a `.fb-form__controls` wrapper (previously classless buttons, wrapped only on multi-step forms). CSS or tests targeting the old bare buttons need the new hooks.

  **Features:**

  - Flow authoring without ids: steps are named by title (ids auto-generated, never shown), field assignment is exclusive with an unassigned-fields list, and save-time normalization dedupes fields across steps.
  - `message` field type: display-only rich text between fields, never validated or stored, condition-targetable, recall-token aware.
  - Response settings (`response` group + tab): success `message` rich text, `redirect` URL (fires on the custom-`children` path too), and `submitLabel` with prop-over-document-over-default precedence.
  - Display settings (`display` group + tab): opt-in form title (`showTitle`/`title`) and rich text `intro` rendered above the fields, recall-token aware.
  - Field config layout: the Field tab lays basics out in rows (name/label, width/placeholder), `width` is required with a `full` default, and `required` sits last.
  - Poll lifecycle: `closesAt` close date enforced at submission time, `resultsVisibility` (`afterVote`/`afterClose`) gating for anonymous results, a `results.access` seam for multi-tenant scoping, and `poll: { votedCookie: true }` for an httpOnly SSR voted marker read via `hasVotedCookie`.
  - Poll option sources: `definePollOptionSource` + the `poll.sources` registry resolve a poll's choices from host domain data at render (`resolvePollOptions` + `toFormDocument(doc, { pollOptions })`) and at submission (resolved values are the only accepted answers, fail closed).
  - Poll outcome: `resolvePollOutcome` records a final `winningValue` (admin read-only, server-only write path); `<Poll>` renders the final state and `<FormResults winningValue>` highlights the winner.
  - `richText.editor` overrides the editor on both action body fields (e.g. a minimal toolbar for email authors); a custom `richText.serialize` now receives the submitted `form` and `req` for per-tenant lookups or handing off to react-email.
  - Composable chrome: `<FormControls>` (the default buttons with all `render*`/className overrides) and `<FormSteps>` (step progress with `aria-current`) are exported for custom `children` layouts, and `useFormContext` exposes the controller context including resolved `labels`, the active `t`, and `effectiveValues`.
  - Server-safe `toFormDocument`: no `'use client'` directive, exported from the root and the `/rsc` subpath (which also gains `resolvePollOptions`, `resolvePollOutcome`, `hasVotedCookie`, `votedCookieName`, and `isPollClosed`), so Server Components narrow the document without pulling in the React client layer.
  - German (`de`) admin and renderer strings ship built in alongside English.
  - The shadcn registry now covers every built-in field type (adds date, consent, calculation, and repeater renderers); the default `textarea` type label is now "Textarea".
  - Repeaters with `minRows` start pre-seeded with that many empty rows instead of appearing blank until validation; an explicit `initialValues` entry for the field (including `[]`) still wins over the seed.

  **Fixes:**

  - File fields nested inside a repeater row now get the same server-side upload enforcement as top-level file fields: each captured value is re-derived into a `FileRef` from the stored upload doc (owner, MIME type, and size checked against the sub-field config) instead of storing the raw client-submitted id, and the submission fails closed on a forged id or a missing uploads collection.
  - Upload enforcement is now driven by a field's value kind rather than its block type, so a custom field type registered with `value: 'file'` is captured and enforced (owner/MIME/size) at both the top level and inside repeaters, not just the built-in `file` type.

  **Notes:**

  - The voted cookie is deliberately not `Secure`: it is a UX-only marker (skip re-showing an answered form), never an integrity or auth signal, and staying non-Secure keeps plain-HTTP local development working.
  - No migrations are shipped for the removed/moved `forms` columns (`defaultPresentation`, `showResults`, top-level `resultsField`); pre-1.0 with no known production consumers, write your own if you carry data.

## 0.1.0-beta.3

### Minor Changes

- Bundled captcha adapters and widget components. `turnstileProvider`, `recaptchaProvider` (v2 + v3 with `minScore`), and `hcaptchaProvider` verify tokens server-side with fail-closed semantics (network errors, timeouts, and non-2xx responses reject the submission). Matching headless `TurnstileCaptcha`, `RecaptchaCaptcha`, and `HcaptchaCaptcha` components on the `/react` export load each vendor script once, report tokens through `onToken` for `<Form captchaToken>`, clear on expiry or error, and expose `reset` (plus on-demand `execute` refresh for reCAPTCHA v3) via a ref handle.

- Feedback round: `date` field type (native date input, real-calendar validation) with `minDate`/`maxDate` rules; rich text notification bodies for `emailTeam`/`confirmation` using the project's configured editor, serialized with escaping, sanitized links, `{{ name|fallback }}`/`{{*}}`/`{{*:table}}` tokens, a plugin `richText { converters, serialize }` option for custom nodes and non-HTML channels, and `renderBody` on action run args; the confirmation recipient is a select over the form's email fields, validated server-side on save; `signedWebhook` validates its URL as absolute http(s) and describes its config fields; calculation expressions get an admin description, Monaco JSON-schema autocomplete, and save-time validation of the expression tree; the file field's `mimeTypes` is a curated select and `maxSize` live-previews as a human-readable size, with a client-side size pre-check and hint line on the renderer; flow transitions resolve against effective values so calculation fields can drive branching; the forms document (Fields/Flow/Actions) and every field block (Field/Validation/Advanced) use tabbed admin layouts, and admin components ship their own CSS (no `styles.css` import needed for the admin). New exports: `serializeBody`, `defaultBodyConverters`, `sanitizeUrl`, `escapeHtml`, `renderAllValues`, `renderAllValuesTable`, `fileMimeTypeOptions`, `formatBytes`, `defaultFieldDefinitionsByType`, `defaultValidationRulesByType`, and the `ByteSizeField`/`FieldNameSelect` client components.

  **Soft compat:** existing plain-string action bodies keep working through the send path (interpolated exactly as before), though the admin editor shows them as empty rich text until re-entered. File fields keep enforcing stored free-text MIME values, but values outside the curated list need re-selecting the next time that field is edited; submitted data is untouched.

  **Postgres migration note:** on `@payloadcms/db-postgres`, two `forms` column types change: action `body` goes `varchar` to `jsonb` (pre-existing string bodies are not valid JSON, so cast with `USING to_jsonb(body)` when writing the migration), and `mimeTypes` moves from a text array to an enum-backed select. Mongo needs no migration. The project config must also set an `editor` (rich text bodies inherit it; Payload throws `MissingEditorProp` without one).

### Patch Changes

- The registry (shadcn-style) file field now matches the built-in file renderer: a client-side max-size pre-check rejects oversized files before uploading, and an accepted-types/max-size hint line renders under the input.

  `minDate`/`maxDate` rule bounds are now validated as real `YYYY-MM-DD` calendar dates in the admin UI, so a malformed bound (e.g. `abc` or `2024-02-30`) is rejected at config time instead of silently breaking the rule's comparisons.

## 0.1.0-beta.2

### Minor Changes

- Add `repeater` field type: a field that captures a dynamic list of rows, each containing a set of sub-fields defined once in the admin UI. Includes row-count validation (`minRows`/`maxRows`), a client-side renderer with add/remove row controls, per-row sub-field validation on the server, and a numbered row view in the submission answers panel.

  Fix `minRows` zero-row bypass: a repeater submitted with no rows was silently accepted even when `minRows > 0`, because the empty-array coercion was immediately skipped by the field loop's empty guard. The guard now lets repeaters fall through to `validate()` so row-count constraints are enforced correctly.

  Fix sub-field error display: server-side sub-field validation errors (reported with path `fieldName[rowIndex].subFieldName`) are now surfaced inline next to the offending input in the repeater renderer. Client-side sub-field validation also runs on submit so errors appear before the request is sent.

  Replace `deepMerge`-based collection overrides with an explicit spread API. The `overrides` plugin option now accepts `CollectionOverrides` objects for `forms`, `formSubmissions`, and `uploads`. Fields are overridden via a `FieldsOverride` function (`({ defaultFields }) => Field[]`) that receives the plugin's defaults and returns the final array, making additions and removals intentional. Hooks are appended after the plugin's own hooks, guaranteeing that the spam guard and submission validator always run first. Spread order per key is documented and encodes who wins without relying on a merge library.

  Add `renderSubmit`, `renderNext`, and `renderBack` render props to `<Form>` for replacing the default control buttons with custom components. Also add `submitButtonClassName`, `nextButtonClassName`, and `backButtonClassName` for styling the default buttons without replacing them.

  Add `showSubmissionRawFields` plugin option. The submission admin view now renders a formatted `SubmissionAnswers` component (formatted values, repeater rows, consent proofs, metadata) as the primary view. The raw `values`, `descriptors`, and `consent` JSON fields are hidden by default because they are fully represented by this component; set `showSubmissionRawFields: true` to show them.

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
