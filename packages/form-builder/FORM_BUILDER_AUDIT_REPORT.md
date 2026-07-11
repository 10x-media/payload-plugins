# Form Builder Plugin — Technical Audit Report

**Project:** `@10x-media/form-builder` v0.1.0-beta.0
**Repository:** 10x-media/payload-plugins
**Audit Date:** 2026-07-01
**Audit Basis:** README.md (1434 lines), package.json, dev app structure
**Auditor:** Automated code agent

> **Disclaimer:** All conclusions are drawn exclusively from the README, package.json, and dev app configuration. Source code was not inspected. Assumptions are labelled.

---

## 1. Executive Summary

**Overall Assessment:** A thoughtfully architected, headless-first form builder for the Payload CMS ecosystem. The plugin demonstrates strong engineering discipline: consistent API conventions, server-authoritative validation, isomorphic condition/calculation engines, comprehensive accessibility testing, and multiple progressive styling pathways. However, it remains a **developer-oriented SDK** rather than a turnkey product. Critical non-technical users (content editors, marketers) lack a visual form builder, drag-and-drop authoring, templates, or import/export — features that competing products have shipped for years.

**Maturity Level:** Beta — Feature-complete v1 SDK, but with visible deferred items and missing visual authoring tools.

| Dimension | Assessment |
|---|---|
| API stability | High — consistent conventions, typed exports, documented contract |
| Visual tooling | Low — JSON-only authoring; visual builders all deferred |
| Production readiness | Moderate — server-side is solid; client-side overlays lack portals |
| Ecosystem integration | Low — no templates, no marketplace, no off-the-shelf integrations |

**Major Strengths:**
- Headless architecture with three BYO styling paths (CSS, custom renderers, raw hooks)
- Server-authoritative validation and calculation engines — client never trusted
- Consistent `false | true | object` registry convention across all extensibility points
- Accessibility verified by axe-core (unit + e2e tiers)
- No-eval calc engine with depth guards and totality guarantees
- Consent system with proof-by-reference and version capture
- Isomorphic condition engine reusable client and server side

**Major Weaknesses:**
- No visual form builder — editors author forms as JSON blocks in Payload's admin
- All visual tools deferred: calc builder, flow builder, custom action UI
- No form templates, import/export, versioning, or draft/autosave for form documents
- Rate limiter is a soft limit (no atomic KV increment)
- Captcha is seam-only — zero bundled providers
- Overlays use CSS `position: fixed` instead of React portals
- shadcn registry not yet hosted (blocker for styled-component path)
- Identity resolution is best-effort and proxy-dependent
- No repeating field groups, no rich text field type
- No collaboration, no analytics dashboard, no A/B testing

---

## 2. Architecture Review

### 2.1 Code Organization

**Evidence (package.json exports):**
```
"." → ./src/index.ts
"./types" → ./src/exports/types.ts
"./client" → ./src/exports/client.ts
"./react" → ./src/exports/react.ts
"./styles.css" → ./styles/form-builder.css
"./rsc" → ./src/exports/rsc.ts
"./i18n" → ./src/exports/i18n.ts
```

**Assessment:** Clean subpath export strategy. Separation of isomorphic code (root), React renderer (`./react`), client-only code (`./client`), React Server Components (`./rsc`), and i18n (`./i18n`) is well-considered. Shows awareness of bundler tree-shaking and server/client boundaries.

**Potential issue:** The full source tree layout is undocumented. No architecture diagram exists to explain how the `src/` directory is organized internally. Without source access, the internal module graph and dependency direction are opaque.

### 2.2 Separation of Concerns

**Positives:**
- Logic (validation, conditions, calculations, flow) is pure and isomorphic — no React, no DOM
- Renderer layer is separate (`./react`) and pluggable
- Server and client engines share the same `evaluateCondition` / `evaluateCalc` functions
- Presentations are a thin composition of individually-exported primitives (DialogSurface, Backdrop, useFocusTrap, useScrollLock, useDismiss)

**Concerns:**
- The `FormDocument` type carries both field definitions and flow configuration in a single object. This couples form structure with presentation logic and could make future form revisions or versioning more complex.

### 2.3 Extensibility

**Rating: Excellent.** Every extension point follows the same convention:

| Extension Point | Mechanism | Convention |
|---|---|---|
| Field types | `defineFormField` | `false \| true \| object` |
| Validation rules | `defineValidationRule` | `false \| true \| object` |
| Renderers | `defineFieldRenderer` + `resolveRenderers` | `false \| true \| object` |
| Actions | `defineAction` | `false \| true \| object` |
| Consent sources | `defineConsentSource` | `false \| true \| object` |
| Presentations | Plugin option + render prop | `false \| true \| object` |
| Captcha providers | `defineCaptchaProvider` | seam only |
| Event sink | `FormEventSink` interface | no-op by default |
| Rate limiter | `RateLimiter` interface (KV default, Redis swappable) | pluggable |

**Concern:** Custom fields require a TypeScript cast (`as FieldTypeOption`) at the registry boundary. The README calls this out, but it suggests the generic typing of `defineFormField` doesn't flow cleanly through the `fields` option. Same for `defineValidationRule` (`as ValidationRuleOption`). This is a paper-cut that every custom field author will hit.

### 2.4 Plugin Architecture

The plugin installs as a standard Payload v3 plugin via `formBuilder({...})`. It provisions:
- A `forms` collection (authoring)
- A `form-submissions` collection (data)
- A `form-uploads` collection (files, optional)
- REST endpoints (`/api/form-submissions`, `/api/forms/:id/results`)
- Admin UI extensions (field blocks, answers view)

The `disabled: true` option returns config unchanged — a thoughtful touch for per-environment toggling.

### 2.5 Dependency Management

**Peers:** `payload@^3.82.0`, `@payloadcms/ui@^3.82.0`, `react@^19.0.0`, `react-dom@^19.0.0`

**Concern:** The tight peer range on Payload (`^3.82.0`) means every Payload minor bump is a potential breaking change for this plugin. With Payload still evolving rapidly (pre-4.0), this could create frequent compatibility issues.

**Missing:** No mention of `@10x-media/jobs` as a peer or optional dependency despite being referenced for the action pipeline. The `spam.rateLimit.limiter` uses `payload.kv` — if KV is Payload v3.82+ specific, that locks the peer further.

### 2.6 Scalability Concerns

- **Aggregation is in-memory:** `aggregateFieldResponses` pages `payload.find` and reduces in JS. Capped at 10,000 submissions. The README explicitly notes this is not a durable snapshot and defers long-term rollups to an analytics plugin. For forms with high submission volume, this is a bottleneck.
- **Rate limiter is a soft limit:** Concurrent bursts can exceed the cap because `payload.kv` has no atomic increment. Production deployments with significant traffic will need a Redis limiter.
- **No mention of caching:** Form documents, consent link resolution, and aggregation results have no documented caching strategy.

---

## 3. Feature Completeness

### 3.1 Field Types

| Feature | Status |
|---|---|
| Text | Fully implemented |
| Textarea | Fully implemented |
| Email | Fully implemented |
| Number | Fully implemented |
| Select (single) | Fully implemented |
| Checkbox | Fully implemented |
| Date | Fully implemented |
| File upload (single) | Fully implemented |
| Consent | Fully implemented |
| Calculation | Fully implemented |
| Hidden (context) | Fully implemented |
| Rich text / HTML | Missing |
| Repeating field groups | Missing (multiple files per field deferred) |
| Rating / star | Documented as example only (not built-in) |
| Phone | Missing |
| URL | Missing (regex-based validation rule exists as `url`, but no dedicated type) |
| Address (composite) | Missing |
| Signature | Missing |
| Payment / Stripe | Missing |
| Likert scale / matrix | Missing |
| File upload (multiple) | Deferred to v1.x |

### 3.2 Validation

| Feature | Status |
|---|---|
| Per-field rules (blocks) | Fully implemented |
| minLength, maxLength, min, max, pattern, email, url, oneOf | Fully implemented |
| matchesField (cross-field) | Fully implemented |
| notAlreadySubmitted (async, server-only) | Fully implemented |
| Custom rules via `defineValidationRule` | Fully implemented |
| Custom messages with `{var}` interpolation | Fully implemented |
| Error vs. warning severity | Fully implemented |
| Standard Schema escape hatch (zod, valibot) | Fully implemented |
| Server-authoritative (client never trusted) | Fully implemented |
| Progressive validation (blur → change → submit) | Fully implemented |
| Conditional validation (`validateWhen`) | Fully implemented |
| Real-time async validation | Not documented |
| Validation groups (multiple fields at once) | Not documented |

### 3.3 Conditional Logic

| Feature | Status |
|---|---|
| `visibleWhen` per field | Fully implemented |
| `validateWhen` per field | Fully implemented |
| Payload `Where` syntax | Fully implemented |
| Native condition builder UI | Fully implemented |
| Server enforcement | Fully implemented |
| Isomorphic engine (`evaluateCondition`) | Fully implemented |
| AND/OR nesting | Fully implemented (via Where) |
| Multi-condition groups | Implied (via Where structure) |
| Conditional actions | Deferred to v1.x |
| Visual logic builder | Deferred |

### 3.4 Multi-Step Forms

| Feature | Status |
|---|---|
| Serializable step graph | Fully implemented |
| Conditional branching/skipping | Fully implemented |
| Auto-driven navigation (Back/Next/Submit) | Fully implemented |
| Per-step validation | Fully implemented |
| `useFormStep` hook for custom UI | Fully implemented |
| Isomorphic flow engine | Fully implemented |
| Visual flow builder | Deferred |
| Progress persistence (resume partially completed form) | Not documented |
| Step animations/transitions | Not documented |

### 3.5 Core Workflow

| Feature | Status |
|---|---|
| Draft/autosave for form authoring | Not documented (uses native Payload drafts if enabled) |
| Form versioning/revisions | Not documented |
| Form duplication | Not documented (may rely on native Payload duplicate) |
| Form templates | Missing |
| Import/export (JSON, CSV) | Missing |
| Undo/Redo in builder | Missing (JSON block editing makes this a native Payload concern) |
| Keyboard shortcuts | Not documented |
| Form preview | Partial (dev app has demo pages, but not an in-admin preview) |
| Schedule publish/expire | Not documented |
| Form status (draft/published/archived) | Not documented |

### 3.6 Post-Submit

| Feature | Status |
|---|---|
| Email notification (team) | Fully implemented |
| Confirmation email (submitter) | Fully implemented |
| Signed webhook (HMAC-SHA256) | Fully implemented |
| Custom actions via `defineAction` | Fully implemented |
| Action ordering | Fully implemented |
| Job queue integration | Fully implemented |
| Inline fallback | Fully implemented |
| Conditional notifications | Deferred to v1.x |
| Thank-you redirect (URL) | Not documented |
| PDF generation | Missing |
| CRM integration (HubSpot, Salesforce) | Missing |
| Webhook retry | Not documented |
| Action logging/audit | Not documented |

### 3.7 Spam and Security

| Feature | Status |
|---|---|
| Honeypot | Fully implemented (on by default) |
| Rate limiting (submissions) | Partially implemented (soft limit only) |
| Rate limiting (uploads) | Partially implemented (soft limit only) |
| Captcha adapter seam | Fully implemented |
| Bundled captcha providers | Missing (Turnstile, reCAPTCHA, hCaptcha all deferred) |
| Upload ownership scoping | Fully implemented |
| IP/UA metadata capture (opt-in) | Fully implemented |
| Multi-layer defense guidance | Documented |
| Cookie/IP dedup | Deferred |
| Akismet integration | Missing |
| Submission moderation/approval queue | Not documented |

### 3.8 Polls

| Feature | Status |
|---|---|
| Aggregation utility | Fully implemented |
| `<FormResults>` (headless + shadcn) | Fully implemented |
| `<Poll>` turnkey component | Fully implemented |
| Gated public results endpoint | Fully implemented |
| Per-browser localStorage dedup | Fully implemented (client-side only) |
| Server-enforced one-per-identity | Partially (manual composition only) |
| SSR poll pattern | Documented |
| Real-time results update | Not documented |
| Poll closing date | Not documented |

---

## 4. UX/UI Review

### 4.1 Builder Workflow

**Critical Finding:** There is no visual form builder. Editors add fields as Payload blocks inside a standard blocks array. Adding a text field means selecting "Text" from the block type dropdown, then filling in label, name, description, width, hidden flag, validation rules (more blocks), `visibleWhen`/`validateWhen` conditions (a Where builder), and a `defaultPresentation` select. This is functional but far from the drag-and-drop experience of Gravity Forms, WPForms, or Elementor.

**Impact:** The form authoring experience is Payload-admin-native but feels like configuring a CMS schema, not building a form. Non-technical editors will struggle with machine names, Where syntax, and nested block configurations.

### 4.2 Renderer UX

The headless renderer is a blank canvas — no default styling, no theme. The shadcn registry is the only "pre-styled" path, but it is not yet hosted, making it unavailable without manual file copying.

### 4.3 Mobile Responsiveness

The container-query layout grid (`FormLayout` + `widthProps`) is a progressive touch. However:
- Overlays use CSS `position: fixed` (deferred portal), which can cause stacking context issues on mobile
- No mention of touch-target sizing, mobile keyboard behavior, or mobile file upload UX

### 4.4 Discoverability

- Machine names for fields are required but not auto-generated from labels
- Editor-facing features (presentations, actions, flows) are authored as data blocks — the admin UI will need separate documentation or inline help
- The admin answers view is mentioned but not described in detail

### 4.5 Suggested Improvements

1. Drag-and-drop field ordering in the blocks array (may rely on Payload's built-in block reordering)
2. Auto-generate machine names from field labels with an override option
3. Inline preview of the rendered form within the admin
4. Wizard-style form creation flow for non-technical editors
5. Host the shadcn registry immediately — it is the primary styled UX path

---

## 5. Developer Experience

### 5.1 Documentation Quality

**Rating: Good.** The README is 1434 lines and covers every major feature with code examples. Properties:
- Every API surface has TypeScript examples
- All configuration options are tabled
- Three progressive BYO styling paths are explained with increasing complexity
- A11y contract is explicit with a checklist for custom renderers
- Deferred items are clearly marked

**Gaps:**
- No architecture overview or module dependency diagram
- No troubleshooting section
- No migration guide (needed when moving from another forms solution)
- No performance tuning guide
- No deployment guide beyond the dev app
- The README is the *only* documentation — no dedicated docs site, no API reference

### 5.2 API Design

**Rating: Very Good.** Consistent patterns throughout:
- `define*` factory functions return typed objects
- `false | true | object` convention everywhere
- Isomorphic exports for server and client reuse
- Pure functions where possible (`evaluateCondition`, `evaluateCalc`, `interpolate`)
- React hooks follow standard patterns (`useField`, `useFormState`, `useFormStep`)

**Paper-cuts:**
- TypeScript casts required at registry boundaries (`as FieldTypeOption`, `as ValidationRuleOption`)
- `FormDocument` type is minimal (`{ id, fields, flow? }`) — unclear what other properties exist on the full document
- The `t` translator prop on `<Form>` defaults to `(key) => key` — raw i18n keys will leak to the UI if the consumer forgets to provide a translator

### 5.3 Testing

**Evidence (package.json scripts):**
- Unit tests (`vitest run src`)
- Integration tests (`vitest run tests/int`)
- DB matrix tests (Mongo + Postgres)
- Container tests (real databases)
- E2E tests (`bash scripts/e2e.sh`)
- axe-core accessibility tests (jsdom + Playwright)

**Assessment:** Good tiered testing strategy. The accessibility tests in both unit and e2e tiers are a strong signal. However:
- No test coverage thresholds are documented
- The e2e script is a bash file — unclear if it also runs on Windows
- No visual regression testing mentioned

### 5.4 Build System

Uses `tsdown` for building (a tsup alternative). The dev app uses Next.js with turbopack. The registry uses `shadcn build registry.json`. All consistent with the monorepo's tooling choices.

### 5.5 Error Handling

- Action failures are isolated — a failed action never fails the submission
- Validation errors are typed and mapped to fields
- `submitError` is exposed in `FormState`
- Rate limiter fails open when identity cannot be resolved
- Calculation overflow/division-by-zero returns 0 (total evaluator)
- Not documented: error logging strategy, error monitoring integration

---

## 6. Performance Review

### 6.1 Identified Concerns

| Concern | Severity | Detail |
|---|---|---|
| In-memory aggregation | Medium | `aggregateFieldResponses` pages + reduces in JS, capped at 10k. No DB-level aggregation. |
| Form document size | Low | Forms with many fields embed all config including Where conditions in a single document. Large forms may produce large JSON payloads. |
| No lazy loading for fields | Medium | The renderer renders all steps' fields at mount (hidden via CSS), not just the active step. |
| Overlays: CSS fixed, no portal | Low | Stacking context issues; deferred to portal. |
| No bundle-size analysis | Medium | No mention of bundle-size tracking for the headless renderer or shadcn components. |
| Client-side calc evaluation | Low | Recalculates on every field change. Acceptable for typical forms but could be a concern for forms with dozens of calculation fields. |
| No memoization documented | Low | `resolveRenderers`, `defaultRenderers`, and other configs are not documented as stable references. |

### 6.2 Optimization Opportunities

1. Server-side aggregation using DB-native pipelines (Mongo aggregation, Postgres GROUP BY)
2. Lazy-render non-active steps in multi-step forms
3. Document bundle-size budgets for the `./react` subpath
4. Memoize `resolveRenderers` results with `useMemo` guidance
5. Add a `shouldComponentUpdate` / `React.memo` guideline for custom renderers

---

## 7. Security Review

### 7.1 What the README Indicates

| Area | Status | Evidence |
|---|---|---|
| Server-authoritative validation | Strong | "The client is never trusted" stated multiple times |
| Input sanitization | Implicit | Server validates all values, hidden fields discarded |
| XSS protection | Implicit | Values are typed and coerced; no raw HTML renderer exists |
| CSRF protection | Not documented | No mention of CSRF tokens on submission endpoints |
| File upload validation | Strong | Server re-reads file metadata, enforces MIME/size |
| Upload ownership scoping | Strong | Identity-stamped uploads checked at submit |
| HMAC webhook signing | Strong | `signedWebhook` with constant-time comparison guidance |
| Rate limiting | Moderate | On by default but soft limit only |
| Honeypot | Strong | aria-hidden, off tab order, server-rejected |
| Captcha | Weak | Seam only; no bundled providers; docs give raw fetch example with secret in code |
| Authentication | Implicit | Submissions are anonymous by default; admin is gated via Payload |
| Authorization | Partial | Authenticated forms can gate on `req.user`; no RBAC for form editing |
| API security | Implicit | REST endpoints; no mention of CORS, API keys, or JWT beyond standard Payload auth |
| Encryption | Not documented | No mention of encrypted field values at rest |

### 7.2 Critical Observations

1. **CSRF not documented:** The submission endpoint accepts POST from `<Form>`. Without CSRF protection, a malicious site could forge submissions. This may be handled by Payload's built-in CSRF middleware, but it is not mentioned.

2. **Captcha example leaks pattern:** The README shows `secret: process.env.TURNSTILE_SECRET` used inside `defineCaptchaProvider` — this is correct, but the function body could be copy-pasted to client-side code by less experienced developers.

3. **Rate limiter soft limit:** The README candidly notes "a concurrent burst can slightly exceed the cap." For high-traffic forms, this means the rate limit is a speed bump, not a gate.

4. **Identity resolution is not reliable:** Anonymous identity resolves from `x-forwarded-for` header, which is spoofable if the proxy layer is misconfigured. The README warns about this, but many deployments will misconfigure it.

5. **No encrypted storage for sensitive fields:** No mention of encrypting PII fields (email, phone) at rest in the submissions collection.

---

## 8. Code Quality Assessment

**Note:** This section infers code quality from the API design, documentation, and conventions described in the README. Source code was not inspected.

### 8.1 Design Patterns

| Pattern | Evidence |
|---|---|
| Registry pattern | All extension points use registries with `false/true/object` |
| Strategy pattern | `defineFieldRenderer`, `defineAction`, `defineCaptchaProvider` |
| Factory functions | `defineFormField`, `defineValidationRule`, `defineConsentSource` |
| Observer pattern | `FormEventSink` for lifecycle events |
| State machine | Multi-step flow as serializable graph with transitions |
| Composition | Overlay primitives composed into modal/drawer |
| Dependency inversion | Rate limiter interface swappable (KV → Redis) |

### 8.2 SOLID Assessment

| Principle | Assessment |
|---|---|
| Single Responsibility | Good — field types, validation, rendering, actions are separate concerns |
| Open/Closed | Excellent — registries are open for extension, closed for modification |
| Liskov Substitution | Good — custom field types and renderers follow the same contract as built-ins |
| Interface Segregation | Good — `FieldRendererProps`, `FormEventSink`, `RateLimiter` are focused interfaces |
| Dependency Inversion | Good — the renderer depends on abstractions (renderer registry), not concrete implementations |

### 8.3 DRY Assessment

The `false | true | object` convention is applied consistently across 6+ registries. This is good DRY but could benefit from a shared type utility. The README repeats the convention explanation in multiple sections.

### 8.4 Technical Debt Indicators

1. **Deferred items:** 10+ features explicitly marked as deferred to v1.x
2. **TypeScript casts:** Required at registry boundaries suggests typing friction
3. **CSS `position: fixed`:** Known suboptimal implementation, waiting on portal migration
4. **Soft rate limits:** Known to be insufficient for production, requiring Redis swap
5. **shadcn registry:** Blocked on hosting infrastructure

---

## 9. Missing Documentation

### 9.1 Documentation That Should Exist

| Document | Priority | Reason |
|---|---|---|
| Architecture overview / module map | High | The monorepo structure and internal module graph are opaque |
| API reference (generated from TSDoc) | High | 1434-line README is reference + guide; hard to navigate |
| Migration guide | Medium | Users moving from other form solutions need path |
| Deployment guide | Medium | Explains prod DB setup, email adapter, and proxy config |
| Troubleshooting / FAQ | Medium | Common issues (rate limits, identity, captcha setup) |
| Performance optimization guide | Medium | Caching strategies, aggregation at scale, bundle size |
| Contribution guide | Low | Standard for open source |
| Plugin development guide | Low | How to build on top of the form builder (custom integrations) |
| Changelog | Low | Not found in README (exists as separate CHANGELOG.md in dev/) |
| Security policy | Low | Responsible disclosure, supported versions |

---

## 10. Competitive Comparison

### 10.1 Comparison Matrix

| Feature | @10x-media/form-builder | Gravity Forms | WPForms | Form.io | SurveyJS | React Hook Form |
|---|---|---|---|---|---|---|
| Visual drag-drop builder | No (JSON blocks) | Yes | Yes | Yes | Yes | N/A (library) |
| Headless renderer | Yes | No | No | Yes | No | Partial |
| Multi-step + branching | Yes | Yes | Yes | Yes | Yes | Manual |
| Calculations | Yes (AST, no-eval) | Yes | Yes | Yes | Yes | Manual |
| Conditional logic | Yes (Where syntax) | Yes | Yes | Yes | Yes | Manual |
| File uploads | Yes (single, server-verified) | Yes | Yes | Yes | Yes | N/A |
| Consent / GDPR | Yes (proof-by-reference) | Partial | Partial | Partial | No | N/A |
| Polls | Yes (built-in) | Add-on | Add-on | No | No | N/A |
| Signed webhooks | Yes (HMAC) | Add-on | Add-on | No | No | N/A |
| Accessibility tested | Yes (axe, unit+e2e) | Partial | Partial | Partial | Partial | Depends on consumer |
| Spam protection (built-in) | Honeypot + rate limit | Honeypot + captcha | Honeypot + captcha | No | No | N/A |
| Templates | No | 30+ | 100+ | No | 20+ | N/A |
| Import/Export | No | Yes | Yes | Yes | Yes | N/A |
| Payment integration | No | Yes (Stripe, PayPal) | Yes | No | No | N/A |
| Email marketing integration | No | Yes (Mailchimp, etc.) | Yes | No | No | N/A |
| CRM integration | No | Yes (HubSpot, etc.) | No | No | No | N/A |
| Entry management | Native Payload collection | Yes | Yes | Yes | Yes | N/A |
| Entry export (CSV) | Not documented | Yes | Yes | Yes | Yes | N/A |
| Form scheduling | Not documented | Yes | No | No | No | N/A |
| Form limits (entries) | Not documented | Yes | No | No | Variable | N/A |
| A/B testing | No | Add-on | No | No | No | N/A |
| Partial submissions save | Not documented | Yes | Yes | No | No | N/A |
| Collaboration | No | No | No | No | No | N/A |
| i18n | Yes (typed keys, overrideable) | Yes | Yes | Yes | Yes | N/A |
| AI features | No | No (third-party) | No | No | No | N/A |

### 10.2 Differentiation Analysis

**Where it wins:**
- Native Payload integration — zero impedance mismatch with the CMS
- Headless architecture — fits Payload's "bring your own frontend" philosophy
- Consent/GDPR tools — more comprehensive than competitors' checkbox fields
- Polling built in — unique among form builders
- Isomorphic engines — same condition/calc logic server and client

**Where it loses:**
- No visual builder (every paid competitor has one)
- No templates (100+ available for WPForms)
- No payment integration
- No marketing/CRM integrations
- No export capabilities

**Target audience:** Developers building Payload-powered sites who are comfortable authoring forms programmatically or via JSON block configuration. Not suitable for non-technical marketing teams who expect a drag-and-drop experience.

---

## 11. Roadmap Recommendations

### High Priority

| # | Item | Effort | Impact | Rationale |
|---|---|---|---|---|
| 1 | Host the shadcn registry | Low | High | The primary styled-component path is currently unavailable. This blocks the most accessible UX for adopters. |
| 2 | Add bundled captcha providers (Turnstile, reCAPTCHA) | Medium | High | The seam alone leaves every adopter to implement the same integration. Shipping 2-3 providers is table-stakes for a forms plugin. |
| 3 | Document CSRF protection strategy | Low | Critical | If it exists, document it. If not, add it. Either way, the current silence is a security concern. |
| 4 | Migrate overlays to React portals | Medium | Medium | CSS `position: fixed` causes stacking/z-index bugs. Already deferred — prioritize. |
| 5 | Visual form builder MVP (drag-drop field ordering) | High | High | The single biggest adoption blocker. Even a simple drag-to-reorder UX in the blocks array would dramatically improve the editor experience. |

### Medium Priority

| # | Item | Effort | Impact | Rationale |
|---|---|---|---|---|
| 6 | Form templates system | Medium | Medium | A template registry (like the renderer registry) would let users start from common patterns. |
| 7 | Repeating field groups | High | High | Every survey and application form needs this. Marked as deferred but should be elevated. |
| 8 | Rich text / HTML field type | Medium | Medium | Essential for informational sections, disclaimers, and rich descriptions within forms. |
| 9 | Submission export (CSV/JSON) | Low | Medium | Editors need to export data. Without it, the submissions collection is a black box. |
| 10 | Conditional post-submit actions | Medium | Medium | Already deferred to v1.x. Allows "send email only if field X is Y". |
| 11 | Form scheduling (publish/expire) | Low | Medium | Seasonal forms, limited-time surveys need this. |
| 12 | Server-side aggregation using DB-native queries | Medium | Medium | The 10k cap on in-memory aggregation is a scalability cliff. |

### Low Priority

| # | Item | Effort | Impact | Rationale |
|---|---|---|---|---|
| 13 | Form versioning/drafts | Low | Low | May leverage Payload's native versioning. Needs documentation either way. |
| 14 | Partial submission save | Medium | Medium | Users abandoning multi-step forms lose all progress. Storage could be `localStorage`. |
| 15 | Cookie/IP dedup for polls | Medium | Low | Server-enforced dedup beyond the localStorage guard. |
| 16 | Phone and URL field types | Low | Low | Low-hanging fruit; URL validation already exists as a rule. |

### Nice-to-Have

| # | Item | Effort | Impact | Rationale |
|---|---|---|---|---|
| 17 | Visual calculation builder | High | Medium | AST-based calculations are powerful but intimidating. A UI would unlock them for non-devs. |
| 18 | Visual flow (multi-step) builder | High | Medium | Same as above; graph-based flows are hard to author as JSON. |
| 19 | Payment field (Stripe) | High | High | Unlocks donation forms, order forms, paid registrations. |
| 20 | AI form generation | Medium | High | "Build me a contact form" → complete form config. Differentiator. |
| 21 | Form analytics dashboard | High | Medium | Submission volume, abandonment rate, field-level drop-off. |
| 22 | A/B testing | High | Medium | Compare two form variants for conversion rate. |

---

## 12. Future Ideas

### Differentiating Features

1. **AI Form Generation:** Natural language → form config. "Build me a job application form with resume upload, cover letter, and EEO questions." Generates fields, validation rules, and multi-step flow.

2. **AI Validation Suggestions:** Analyze submission patterns and suggest validation rules (e.g., "30% of submissions fail on the phone field — add a pattern rule").

3. **AI Conditional Logic:** "Only show the dietary restrictions field when the attendee selects the dinner option" → generates `visibleWhen` Where clause.

4. **Form Conversion Analytics:** Track field-by-field abandonment, time-to-complete, and error hotspots. Expose this as a per-form dashboard in the admin.

5. **Form Marketplace:** Let the community publish form templates, custom field types, renderers, and action integrations. Extend the registry pattern to a remote marketplace.

6. **Workflow Automation:** Connect form submissions to `@10x-media/automations` (same monorepo) for visual workflow triggers. "When a form is submitted, create a CRM lead and notify Slack."

7. **Reusable Field Groups:** "Address block" (street, city, zip, country) defined once, used across forms. Changes propagate.

8. **Form Embedding SDK:** A lightweight `<script>` tag that embeds a Payload-hosted form on any external website with CORS-safe submission.

9. **Headless Form-as-a-Service:** A separate front-end rendering layer decoupled from Payload, consuming forms entirely via REST API.

10. **Collaborative Form Editing:** Real-time co-editing of form configuration (similar to Google Docs), backed by Payload's real-time infrastructure.

---

## 13. Critical Issues

| # | Severity | Description | Impact | Recommended Fix |
|---|---|---|---|---|
| 1 | **High** | No visual form builder — editors author forms via JSON blocks | Blocks non-technical adoption; competitive disadvantage | Prioritize a drag-to-reorder field builder even if other visual tools wait |
| 2 | **High** | shadcn registry not hosted | The primary styled-renderer path is unavailable to users | Host on docs site or GitHub Pages; this is infrastructure work, not code |
| 3 | **Medium** | CSRF protection not documented for submission endpoint | Potential for cross-site form submission forgery | Document Payload's CSRF behavior or add explicit protection |
| 4 | **Medium** | Rate limiter is a soft limit (no atomic increment) | Production traffic can exceed configured limits | Ship a Redis-backed limiter or document how to configure one |
| 5 | **Medium** | Captcha is seam-only — zero providers bundled | Every adopter must implement their own captcha integration | Bundle Turnstile and reCAPTCHA adapters |
| 6 | **Medium** | Identity resolution is proxy-dependent and unreliable | Rate limits and upload scoping may not apply correctly in misconfigured deployments | Add cookie-based identity fallback; improve configuration docs |
| 7 | **Medium** | Overlays use CSS `position: fixed` instead of React portals | Stacking context bugs on sites with other fixed elements or z-index management | Migrate to `createPortal` (already deferred — elevate priority) |
| 8 | **Low** | TypeScript casts required at registry boundaries | Every custom field/rule author must add `as FieldTypeOption` / `as ValidationRuleOption` | Investigate whether the generic signature can be tightened to eliminate the cast |
| 9 | **Low** | `t` translator prop defaults to `(key) => key` | Raw i18n keys leak to the UI if no translator is provided | Default to English translations from the `en` translation map |
| 10 | **Low** | No form templates or import/export | Users must build every form from scratch | Add a template system using the existing registry pattern |
| 11 | **Low** | Aggregation capped at 10k, in-memory only | High-volume forms cannot be reliably aggregated | Implement DB-native aggregation or add pagination/warning |
| 12 | **Low** | No mention of encrypted field storage | PII in submissions is stored in plain text | Add a `sensitive: true` field option that encrypts at the application layer |

---

## 14. Overall Scores

| Category | Score (1-10) | Notes |
|---|---|---|
| Architecture | 8 | Excellent headless design, isomorphic engines, consistent registry convention. Minus for undocumented internal module graph and reliance on JSON authoring for visual concerns. |
| Features | 6 | Core form features are solid. Major gaps: no visual builder, no templates, no repeating groups, no payment/CRM integrations, no export. The SDK is comprehensive; the product is incomplete. |
| UX | 4 | Strong developer UX (API, types, docs). Weak editor UX (JSON block authoring, no drag-drop, no visual tools). Weak visitor UX (no default styling; shadcn registry not available). |
| Developer Experience | 8 | Excellent API design, consistent conventions, good error boundaries. Minor TypeScript friction at registry boundaries. Docs are thorough but all-in-one-file. |
| Documentation | 7 | 1434-line README is comprehensive with code examples for everything. Missing: architecture diagrams, deployment guide, migration guide, API reference, troubleshooting. |
| Performance | 6 | Good: isomorphic engines, no-eval calc. Concerns: in-memory aggregation with caps, no lazy step rendering, no documented bundle-size budgets, soft rate limits. |
| Security | 7 | Strong: server-authoritative, file upload enforcement, honeypot, HMAC webhooks. Weak: no CSRF docs, soft rate limits, proxy-dependent identity, no encrypted PII storage. |
| Maintainability | 8 | Consistent patterns, well-defined extension points, clean separation of concerns. Concern: 10+ deferred features create a backlog of v1.x work. |
| Scalability | 5 | Single Payload instance works well. Concerns: in-memory aggregation cap, soft rate limits, no caching strategy, form documents grow with field count. |
| Innovation | 7 | Polls built-in, consent proof-by-reference, isomorphic engines, multi-styling paths are novel. Not revolutionary — follows established form builder patterns with Payload-native execution. |

### Weighted Overall Score: **6.4 / 10**

**Verdict:** A strong SDK with a solid architectural foundation, held back by the absence of visual authoring tools, missing integrations (payments, CRM, marketing), and several deferred critical-path features. Suitable for developer-led Payload projects today; not yet competitive with established form builders for non-technical teams. The deferred backlog is substantial and carries execution risk.

---

## Appendix A: Assumptions and Limitations

1. **Source code not inspected.** All conclusions are drawn from the README, package.json, and dev app structure. Implementation quality, test coverage percentages, and internal code organization could not be verified.

2. **README may be aspirational.** Features described in the README may not yet be fully implemented or tested. The `beta` status tag suggests active development.

3. **No runtime testing.** Performance benchmarks, bundle-size measurements, and real-world rendering behavior were not measured.

4. **Competitive comparison** is based on publicly documented features of Gravity Forms, WPForms, Form.io, SurveyJS, and React Hook Form as of mid-2026.

5. **The deferred label** is the plugin's own classification. Some items labeled "deferred" may already be partially implemented in source.
