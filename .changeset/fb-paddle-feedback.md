---
"@10x-media/form-builder": minor
---

Feedback round: flow authoring, localized content, response/display settings, bring-your-own uploads, poll lifecycle, composable form chrome, and a German locale.

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
