import type { CollectionSlug } from 'payload'
import type { RichTextBodyOption } from './actions/body/serializeBody'
import type { RecipientsConfig } from './actions/emailRecipients'
import type { FromAddressesResolver } from './actions/fromAddresses'
import type { RecipientSourceRegistry } from './actions/recipientSources'
import type { ActionsConfig } from './actions/registry'
import type { FormResultsAccess } from './aggregation/resolveResultsRequest'
import type { ButtonsOption } from './collections/buttonFields'
import type { ResponseOption } from './collections/redirectFields'
import type { SettingsOption } from './collections/settingsFields'
import type { ConsentSnapshotMode } from './consent/captureConsent'
import type { ConsentSourcesResolver } from './consent/types'
import type { DepartmentEmailsResolver } from './email/departments'
import type { FormEventSink } from './events/types'
import type { FieldTypesConfig } from './fields/registry'
import type { CollectionOverrides } from './plugin/collectionOverrides'
import type { UploadsOption } from './plugin/uploadsCollection'
import type { OutcomeFieldsOverride } from './poll/outcomeFields'
import type { PollTypesConfig } from './poll/pollTypeRegistry'
import type { PollOptionSourcesConfig } from './poll/registry'
import type { SpamOption } from './spam/types'
import type { TranslationsOption } from './translations'
import type { ValidationRulesConfig } from './validation/registry'

export type FormBuilderPluginOptions = {
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/form-builder/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	/** Pluggable sink for form lifecycle events. Defaults to a no-op; analytics adapters or a future analytics plugin subscribe here. */
	events?: FormEventSink
	/**
	 * Content-bearing author fields (labels, placeholders, option labels, action subjects and
	 * bodies) are localized by default. Payload strips the `localized` flag on hosts without
	 * `localization` configured, so the default is safe everywhere. Set `false` to keep form
	 * content single-locale even on localized hosts. Spread-overrides of the prebuilt default
	 * exports (`defaultFieldDefinitionsByType`, `defaultActionDefinitions`) carry `localized`
	 * flags from the default-true set; when opting out, derive overrides from
	 * `buildDefaultFieldDefinitions(false)` / `buildDefaultActionDefinitions({ localize: false })` instead.
	 * Consent statements are unaffected either way: they live on the host's own
	 * `consentSourcesField()`, which carries its own `localized` option.
	 */
	localizeContent?: boolean
	/** Add, override, or remove field types. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	fields?: FieldTypesConfig
	/** Add, override, or remove validation rule types. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	rules?: ValidationRulesConfig
	/** Add, override, or remove post-submit action types. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	actions?: ActionsConfig
	/**
	 * Customize how the plugin's rich text is authored and rendered. `editor` is the default
	 * Lexical/richText editor for every plugin richText field (message content, consent
	 * statement, response message, action bodies); `bodyEditor` overrides the action body
	 * fields and `responseEditor` overrides the success response message field, each falling
	 * back to `editor`. `converters` spread over the default
	 * Lexical node converters; `serialize` replaces the whole action-body pipeline (e.g. to
	 * target chat or plain-text channels instead of email HTML). A custom `serialize` receives
	 * the submitted `form` (id/title) and `req`, enabling per-tenant lookups or handing the raw
	 * body off to a renderer like react-email.
	 */
	richText?: RichTextBodyOption
	/**
	 * Email routing for the `emailTeam` and `confirmation` actions. Both sub-options are opt-in by the
	 * presence of a resolver (not a `false`/`true`/object flag) and share a shape: a `req`-scoped
	 * resolver, evaluated per request via an endpoint, whose choice is validated at save time only and
	 * never re-checked when the action sends (the config is admin-authored, not visitor-controlled).
	 *
	 * `fromAddresses` gives both actions a `from` select whose options come from the resolver; absent,
	 * neither action has a `from` field and every send uses the email adapter's default sender. The
	 * intended use is multi-tenant hosts where each tenant may only send from particular addresses
	 * (derive the tenant from `req`, return its allowed senders). Values are the literal string
	 * `payload.sendEmail` accepts as `from` (e.g. `'Name <addr@x.com>'` or a plain address).
	 *
	 * `departments` turns the `emailTeam` `to` into a select whose options come from the resolver
	 * (a `/:id/departments` endpoint); the intended use is to place `departmentsField()` on a document
	 * you own and read it back with `resolveDepartmentOptions`, which resolves each department's address
	 * for the requesting locale. Because `to` is localized, each admin locale stores its own resolved
	 * address and a submission's locale selects the address it routes to (Payload-native, no per-send
	 * lookup). Storing the resolved address, rather than a department id resolved live at send (consent's
	 * model), is deliberate: the routing target a form was saved with stays audit-stable even if the
	 * resolver's data later changes, so do not "fix" it into a live lookup. Multi-tenant hosts scope
	 * which document they read by the tenant derived from `req`; absent, the recipient fields simply
	 * offer no preset department options (still free-typed emails and field tokens).
	 */
	email?: {
		fromAddresses?: FromAddressesResolver
		departments?: DepartmentEmailsResolver
		/** Narrows the recipient fields' behavior (free-typed emails, field tokens). See {@link RecipientsConfig}. */
		recipients?: RecipientsConfig
		/**
		 * Server-resolved recipients, offered in every recipient field as their own option group and
		 * resolved to addresses at send time. Each source's `value` is a namespaced string (so it cannot
		 * collide with an address); its `resolve` receives the verified form context. See {@link RecipientSource}.
		 */
		recipientSources?: RecipientSourceRegistry
	}
	/**
	 * Where the consent statements a form can reference come from. Absent (the default): no sources,
	 * so the built-in `consent` field type is not registered at all and authors cannot add a consent
	 * field with nothing to reference (a developer-registered custom `consent` type via `fields`
	 * still wins).
	 *
	 * `sources` is an async `req`-scoped resolver returning the sources available to this request.
	 * The intended shape: place `consentSourcesField()` on a collection or global you own and read it
	 * back here. Multi-tenant hosts scope that read by the tenant derived from `req`, so a tenant's
	 * authors only ever see, and their visitors only ever agree to, their own statements. A form
	 * stores only a source's row `id`; the statement is resolved live per request (see
	 * `resolveConsentStatements`) and the proof is rebuilt from the source at submit, so neither is
	 * ever a copy the client could stale or forge.
	 */
	consent?: {
		sources: ConsentSourcesResolver
		/**
		 * What each submission snapshots of the agreed consent wording, for a versioned audit trail.
		 * `'both'` (default) stores a `statementHash`, the plain `statementText`, and the source name;
		 * `'hash'` keeps only the tamper-evident hash; `'text'` only the readable text; `false` keeps the
		 * lean id-only proof. The proof stays id-based regardless; this only adds the wording snapshot.
		 */
		snapshot?: ConsentSnapshotMode
		/**
		 * Whether to resolve each form's consent statements on every read via an afterRead hook (the
		 * default, `true`). It attaches `consentStatements` to the form doc so a host can render the
		 * wording without a second call, at the cost of one source lookup per form read (N on a list).
		 * Set `false` to skip that hook and resolve statements yourself with the exported
		 * `resolveConsentStatements` when you render a form; submit-time proof capture is unaffected either
		 * way (it always re-resolves from the source).
		 */
		resolveOnRead?: boolean
	}
	/**
	 * Form-level button labels: `submitLabel` at the bottom of the Fields tab, `prevLabel` and
	 * `nextLabel` in a row at the bottom of the Flow tab (shown once the flow has a step). The
	 * rendered chrome resolves each label as `<Form>` prop, then the stored value, then the
	 * translated default. `fields` composes them: it receives the three default fields as a
	 * `{ submit, prev, next }` map with the content localization flag already applied and returns
	 * the map, so wrapping a default in a row with a host field (e.g. an icon select) or replacing
	 * one is explicit. `FormDocument.buttons` reassembles only those three known labels, so a
	 * host-added sibling field is still stored but is read off the raw document, not `doc.buttons`.
	 */
	buttons?: ButtonsOption
	/**
	 * Form-level flag fields (`multistep`, `pollEnabled`, `persistSubmissions`), sidebar
	 * checkboxes by default. `fields` composes them from the defaults so a host can
	 * relocate, wrap, extend, or drop them.
	 */
	settings?: SettingsOption
	/**
	 * The success-response group. `redirect.fields` composes the fields inside the `response.redirect`
	 * group, mirroring `buttons.fields`: it receives the default fields (the `url` text field, plus the
	 * polymorphic `reference` relationship when `redirectRelationships` is set) and returns the group's
	 * final field array, so a host can prepend a custom link field (the pattern most projects already
	 * have), swap `url` for their own picker, reorder, or filter. Omit it and the group stays the
	 * built-in `url` (+ optional `reference`), unchanged.
	 *
	 * The plugin's built-in redirect handling reads `redirect.url` (and `redirect.reference` when
	 * configured); `toFormDocument` passes the whole `response` group through, so a host that replaces
	 * `url` with their own link field owns resolving it to a destination in their frontend, the same as
	 * the internal-reference case.
	 */
	response?: ResponseOption
	/**
	 * Collections whose documents `response.redirect` can reference (`response.redirect.reference`),
	 * letting an author redirect a visitor to an internal document instead of a URL after a
	 * successful submit. Absent (the default): no `reference` field exists at all, matching today's
	 * URL-only redirect. Always polymorphic, even for a single slug (a `CollectionSlug[]` array, not
	 * a bare `CollectionSlug`), so a host adding a second collection later never changes the stored
	 * shape, the same precedent as `consentSourcesField()`'s `page` picker. The plugin never resolves
	 * the reference to a URL itself (it has no notion of the host's routing); `toFormDocument` passes
	 * the raw `{ relationTo, value }` pair through on `FormDocument.response.redirect.reference` for
	 * the host to resolve. Mirrors the `redirectRelationships` option of Payload's native
	 * `plugin-form-builder`.
	 */
	redirectRelationships?: CollectionSlug[]
	/**
	 * File uploads are bring-your-own. Default `false`: no upload collection is involved and the
	 * built-in `file` field type is removed from the registry, so form authors cannot add a field
	 * with nowhere to land (a developer-registered custom `file` type via `fields` still wins).
	 * `{ collection: 'slug' }` points at a host-owned upload collection (created by the app with
	 * its storage adapter); the plugin validates it at boot, appends its hidden `owner` field when
	 * absent, and prepends the spam upload hooks.
	 */
	uploads?: UploadsOption
	/** Honeypot + rate-limiting (on by default) + a captcha adapter seam + upload-ownership scoping. `false` disables the whole subsystem. */
	spam?: SpamOption
	/**
	 * Aggregate-results endpoint options. `access` gates anonymous reads after the form is loaded
	 * and before anything is served; absent keeps the plugin-default gating (poll opt-in +
	 * visibility + enumerable-field guard). Multi-tenant hosts should compare `form.tenant` against
	 * the tenant derived from `req` so one tenant's poll counts are never readable under another
	 * tenant's id. Authenticated callers bypass this seam.
	 */
	results?: { access?: FormResultsAccess }
	/**
	 * Poll behavior. `votedCookie: true` sets an httpOnly `fb-voted-{formId}=1` cookie on each
	 * successful submission to a poll-enabled form, letting SSR hosts read the voted state via
	 * `hasVotedCookie` and pass it to `<Poll hasVoted>`. Default `false`.
	 * `sources` registers poll option sources (`definePollOptionSource`), letting authors populate
	 * a poll's choices from host domain data with stable values; there are no built-ins. With at
	 * least one source registered, the forms poll group gains an `optionSource` select plus its
	 * per-source `sourceConfig`, and submissions to a sourced poll only accept resolved values.
	 * `outcomeFields` composes the poll `outcome` group: it receives the two default fields
	 * (`winningValues`, `resolvedAt`) and returns the group's final field array verbatim, so a host
	 * can swap `winningValues` for its own component (e.g. a relationship picker over the voteable
	 * records). Membership validation runs server-side regardless, so a swap cannot bypass it.
	 * `types` registers outcome strategies (`definePollType`) shown in the poll `type` select. The
	 * built-ins `manual` (default, hand-picked), `mostVoted` (auto-resolves to the top choice(s) on
	 * close), and `source` (delegates to the option source) are always registered; a host entry keyed
	 * by (or carrying) a built-in slug replaces it. A closed poll whose strategy is not `manual`
	 * auto-resolves via a scheduled job when a runner is present, or on the next results read otherwise.
	 */
	poll?: {
		votedCookie?: boolean
		sources?: PollOptionSourcesConfig
		types?: PollTypesConfig
		outcomeFields?: OutcomeFieldsOverride
		/**
		 * Poll vote tally store (default on). Votes are counted into an append-only hidden
		 * collection of aggregate rows at submit time, so results reads are O(options), never
		 * truncate, and survive `persistSubmissions: false`. `false` restores scan-based results
		 * (and then a persist-off poll is rejected at save). `overrides` opens the tally
		 * collection (slug stays `form-poll-votes`).
		 */
		votes?: false | { overrides?: CollectionOverrides }
	}
	/**
	 * When `true`, the raw `values`, `descriptors`, and `consent` JSON fields are visible in the
	 * submission admin view. Default `false`, because the `SubmissionAnswers` UI component already
	 * represents those fields fully and they are noisy shown alongside it.
	 */
	showSubmissionRawFields?: boolean
	/**
	 * Override individual plugin-managed collections using explicit spreads. Each key accepts a
	 * `CollectionOverrides` object: top-level keys are spread with the plugin's defaults (spread
	 * order per key determines who wins), hooks are appended after the plugin's own hooks, and
	 * `fields` is a function that receives the default fields and returns the final array so
	 * additions/removals are always intentional.
	 */
	overrides?: {
		forms?: CollectionOverrides
		formSubmissions?: CollectionOverrides
	}
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/form-builder': FormBuilderPluginOptions
	}
}
