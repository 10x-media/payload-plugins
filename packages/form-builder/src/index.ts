import { type Config, definePlugin } from 'payload'
import type { RichTextBodyOption } from './actions/body/serializeBody'
import { buildDefaultActionDefinitions } from './actions/builtin'
import type { FromAddressesResolver } from './actions/fromAddresses'
import type { ActionsConfig } from './actions/registry'
import { resolveActions } from './actions/registry'
import type { FormResultsAccess } from './aggregation/resolveResultsRequest'
import type { ButtonsOption } from './collections/buttonFields'
import { stashConsentSources } from './consent/resolveConsentEntries'
import type { ConsentSourcesResolver } from './consent/types'
import type { FormEventSink } from './events/types'
import { buildDefaultFieldDefinitions } from './fields/builtin'
import { type FieldTypesConfig, resolveFieldTypes, stashFieldTypes } from './fields/registry'
import type { CollectionOverrides } from './plugin/collectionOverrides'
import { registerCollections } from './plugin/registerCollections'
import { registerTranslations } from './plugin/registerTranslations'
import type { UploadsOption } from './plugin/uploadsCollection'
import type { OutcomeFieldsOverride } from './poll/outcomeFields'
import type { PollOptionSourcesConfig } from './poll/registry'
import { resolvePollOptionSources } from './poll/registry'
import { stashPollOptionSources } from './poll/resolvePollOptions'
import { resolveSpamConfig } from './spam/resolveSpam'
import type { SpamOption } from './spam/types'
import type { TranslationsOption } from './translations'
import { defaultValidationRules } from './validation/builtin'
import { resolveValidationRules, type ValidationRulesConfig } from './validation/registry'

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
	 * `buildDefaultFieldDefinitions(false)` / `buildDefaultActionDefinitions(false)` instead.
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
	 * fields specifically, falling back to `editor`. `converters` spread over the default
	 * Lexical node converters; `serialize` replaces the whole action-body pipeline (e.g. to
	 * target chat or plain-text channels instead of email HTML). A custom `serialize` receives
	 * the submitted `form` (id/title) and `req`, enabling per-tenant lookups or handing the raw
	 * body off to a renderer like react-email.
	 */
	richText?: RichTextBodyOption
	/**
	 * Sender address for `emailTeam` and `confirmation`. Absent (default): no `from` field on
	 * either action and every send uses the email adapter's default sender. With
	 * `fromAddresses` set, both actions gain a `from` select whose options come from the
	 * resolver, evaluated per request via a `req`-scoped endpoint. The intended use is
	 * multi-tenant hosts where each tenant may only send from particular addresses (derive the
	 * tenant from `req` and return only its allowed senders). Values are the literal string
	 * `payload.sendEmail` accepts as `from` (e.g. `'Name <addr@x.com>'` or a plain address). The
	 * choice is validated against the resolver at save time only; it is not re-checked when the
	 * action actually sends (the config is admin-authored, not visitor-controlled).
	 */
	email?: { fromAddresses?: FromAddressesResolver }
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
	 * stores only a source's `key`; the statement is resolved live per request (see
	 * `resolveConsentStatements`) and the proof is rebuilt from the source at submit, so neither is
	 * ever a copy the client could stale or forge.
	 */
	consent?: { sources: ConsentSourcesResolver }
	/**
	 * Form-level button labels. Every form carries a `buttons` group (`submitLabel`, `prevLabel`,
	 * `nextLabel`) at the bottom of its Fields tab; the rendered chrome resolves each label as
	 * `<Form>` prop, then the stored value, then the translated default. `fields` composes the
	 * group: it receives the three default fields with the content localization flag already
	 * applied and returns the group's final field array verbatim, so wrapping a default in a row
	 * with a host field (e.g. an icon select), reordering, or dropping one is explicit. Host-added
	 * fields ride along on `FormDocument.buttons` for custom chrome to read.
	 */
	buttons?: ButtonsOption
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
	 */
	poll?: {
		votedCookie?: boolean
		sources?: PollOptionSourcesConfig
		outcomeFields?: OutcomeFieldsOverride
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

export const formBuilder = definePlugin<FormBuilderPluginOptions>({
	slug: '@10x-media/form-builder',
	order: 50,
	plugin: ({ config, plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		const localizeContent = options.localizeContent !== false
		const uploads = options.uploads ?? false
		const consentSources = options.consent?.sources
		// A built-in with nowhere to point never enters the registry, so an author is never offered a
		// field that cannot work: file without an uploads collection has nowhere to store anything,
		// consent without sources has no statement to reference. An explicit `fields.file` /
		// `fields.consent` definition remains a developer choice.
		const defaultFieldDefinitions = buildDefaultFieldDefinitions(
			localizeContent,
			options.richText?.editor
		).filter(
			(definition) =>
				(uploads !== false || definition.type !== 'file') &&
				(consentSources !== undefined || definition.type !== 'consent')
		)
		const registry = resolveFieldTypes(defaultFieldDefinitions, options.fields)
		const ruleRegistry = resolveValidationRules(defaultValidationRules, options.rules)
		const fromAddresses = options.email?.fromAddresses
		const actionRegistry = resolveActions(
			buildDefaultActionDefinitions(
				localizeContent,
				options.richText?.bodyEditor ?? options.richText?.editor,
				fromAddresses
			),
			options.actions
		)
		const spam = resolveSpamConfig(options.spam)
		const pollSourceRegistry = resolvePollOptionSources(options.poll?.sources)
		// Stashed on config.custom so the root-level resolvePollOptions, resolveEffectivePollOptions,
		// and resolveConsentStatements helpers can reach these through `payload.config` at request
		// time, without threading plugin state through the host's own server code. The field-type
		// registry rides along so resolveEffectivePollOptions can look up a results field's
		// definition (and its `resolveOptions`) from a bare `payload` instance.
		config.custom = stashPollOptionSources(config.custom, pollSourceRegistry)
		config.custom = stashFieldTypes(config.custom, registry)
		if (consentSources) {
			config.custom = stashConsentSources(config.custom, consentSources)
		}
		registerTranslations(config, options.translations)
		registerCollections({
			config,
			registry,
			ruleRegistry,
			consentSources,
			actionRegistry,
			richText: options.richText,
			hasJobsPlugin: Boolean(plugins['@10x-media/jobs']),
			events: options.events,
			uploads,
			spam,
			showSubmissionRawFields: options.showSubmissionRawFields ?? false,
			localizeContent,
			resultsAccess: options.results?.access,
			votedCookie: options.poll?.votedCookie === true,
			pollSourceRegistry,
			outcomeFields: options.poll?.outcomeFields,
			buttons: options.buttons,
			fromAddresses,
			overrides: options.overrides,
		})
		return config
	},
})

export type {
	BodyConverter,
	BodyConverterArgs,
	BodyRender,
} from './actions/body/converters'
export { defaultBodyConverters, sanitizeUrl } from './actions/body/converters'
export { escapeHtml } from './actions/body/escapeHtml'
export type {
	BodyContext,
	RichTextBodyOption,
	SerializeBodyArgs,
} from './actions/body/serializeBody'
export { serializeBody } from './actions/body/serializeBody'
export { textOfBody } from './actions/body/textOfBody'
export { renderAllValues, renderAllValuesTable } from './actions/body/wildcards'
export { buildDefaultActionDefinitions, defaultActionDefinitions } from './actions/builtin'
export type { ActionDefinition, ActionRunArgs, AnyActionDefinition } from './actions/defineAction'
export { defineAction } from './actions/defineAction'
export type { FromAddressesResolver, FromAddressOption } from './actions/fromAddresses'
export type { ActionOption, ActionRegistry, ActionsConfig } from './actions/registry'
export { resolveActions } from './actions/registry'
export type { ActionResult } from './actions/runActions'
export { SIGNATURE_HEADER, signPayload } from './actions/sign'
export type {
	AggregateFieldResponsesArgs,
	AggregateFormResponsesArgs,
} from './aggregation/aggregateResponses'
export {
	aggregateFieldResponses,
	aggregateFormResponses,
	fieldHasOptions,
} from './aggregation/aggregateResponses'
export { aggregateRowForField, aggregateRowsForFields } from './aggregation/aggregateRows'
export type {
	FormResultsAccess,
	FormResultsAccessArgs,
	ResolveResultsRequestArgs,
	ResolveResultsRequestResult,
} from './aggregation/resolveResultsRequest'
export { resolveFormResultsRequest } from './aggregation/resolveResultsRequest'
export type {
	AggregationBucket,
	AggregationRow,
	FieldAggregation,
	FieldMeta,
	SubmissionStatusFilter,
} from './aggregation/types'
export { calcExpressionOf, computeCalcFields } from './calc/computeCalcFields'
export { evaluateCalc } from './calc/evaluate'
export { normalizeCalc } from './calc/normalizeCalc'
export type { CalcExpression } from './calc/types'
export type {
	ButtonFieldsOverride,
	ButtonsOption,
	DefaultButtonFields,
} from './collections/buttonFields'
export {
	buildDefaultButtonFields,
	buildNextLabelField,
	buildPrevLabelField,
	buildSubmitLabelField,
} from './collections/buttonFields'
export { evaluateCondition } from './conditions/evaluate'
export type { FieldCondition } from './conditions/types'
export { applyConsentStatements } from './consent/applyConsentStatements'
export type { ConsentProof } from './consent/captureConsent'
export { captureConsent } from './consent/captureConsent'
export type { ConsentSourcesFieldOptions } from './consent/consentSourcesField'
export { consentSourcesField } from './consent/consentSourcesField'
export type { ResolveConsentEntriesArgs } from './consent/resolveConsentEntries'
export { resolveConsentEntries } from './consent/resolveConsentEntries'
export type {
	ConsentSourceOption,
	ResolveConsentSourcesRequestArgs,
	ResolveConsentSourcesRequestResult,
} from './consent/resolveConsentSourcesRequest'
export { resolveConsentSourcesRequest } from './consent/resolveConsentSourcesRequest'
export type {
	ConsentStatement,
	ConsentStatements,
	ResolveConsentStatementsArgs,
} from './consent/resolveConsentStatements'
export { resolveConsentStatements } from './consent/resolveConsentStatements'
export type { ResolvePublishedVersionRefArgs } from './consent/resolvePublishedVersionRef'
export { resolvePublishedVersionRef } from './consent/resolvePublishedVersionRef'
export type {
	ConsentSourceEntry,
	ConsentSourcePage,
	ConsentSourcesResolver,
} from './consent/types'
export {
	buildDefaultFieldDefinitions,
	defaultFieldDefinitions,
	defaultFieldDefinitionsByType,
} from './fields/builtin'
export { fileMimeTypeOptions } from './fields/builtin/file'
export { defineFormField } from './fields/defineFormField'
export { fieldKey } from './fields/fieldKey'
export { localizedIf } from './fields/localizedIf'
export type { FieldTypeOption, FieldTypeRegistry, FieldTypesConfig } from './fields/registry'
export type {
	AnyFormFieldDefinition,
	FormFieldDefinition,
	FormFieldFormat,
	FormFieldValidate,
	FormFieldValueKind,
	OmittableSharedField,
	ResolveFieldOptionsArgs,
} from './fields/types'
export { isPollClosed } from './form/pollState'
export type { ToFormDocumentOptions } from './form/toFormDocument'
export { toFormDocument } from './form/toFormDocument'
export type {
	FormButtonSettings,
	FormDocument,
	FormPollSettings,
	FormResponseSettings,
} from './form/types'
export type { UploadsOption } from './plugin/uploadsCollection'
export type {
	AnyPollOptionSource,
	PollOption,
	PollOptionResolveArgs,
	PollOptionSource,
} from './poll/definePollOptionSource'
export { definePollOptionSource } from './poll/definePollOptionSource'
export type { ResolveEffectivePollOptionsArgs } from './poll/effectivePollOptions'
export { resolveEffectivePollOptions } from './poll/effectivePollOptions'
export type { DefaultOutcomeFields, OutcomeFieldsOverride } from './poll/outcomeFields'
export {
	buildDefaultOutcomeFields,
	buildResolvedAtField,
	buildWinningValuesField,
} from './poll/outcomeFields'
export type {
	PollOptionSourceOption,
	PollOptionSourceRegistry,
	PollOptionSourcesConfig,
} from './poll/registry'
export { resolvePollOptionSources } from './poll/registry'
export type { ResolvePollOptionsArgs } from './poll/resolvePollOptions'
export { resolvePollOptions } from './poll/resolvePollOptions'
export type { ResolvePollOutcomeArgs } from './poll/resolvePollOutcome'
export { resolvePollOutcome } from './poll/resolvePollOutcome'
export type { PrefillOptions } from './prefill/valuesFromSearchParams'
export { valuesFromSearchParams } from './prefill/valuesFromSearchParams'
export { DEFAULT_PRESENTATION_NAME, defaultPresentationDescriptors } from './presentations/defaults'
export type {
	PresentationDensity,
	PresentationDescriptor,
	PresentationSurface,
} from './presentations/types'
export { interpolate } from './recall/interpolate'
export type { RecallResolver } from './recall/resolver'
export { buildRecallResolver, optionLabelsFor } from './recall/resolver'
export { defineCaptchaProvider } from './spam/captcha'
export { CAPTCHA_TOKEN_KEY, DEFAULT_HONEYPOT_FIELD } from './spam/constants'
export { defaultIdentify } from './spam/identify'
export type { HcaptchaProviderOptions } from './spam/providers/hcaptcha'
export { hcaptchaProvider } from './spam/providers/hcaptcha'
export type { RecaptchaProviderOptions } from './spam/providers/recaptcha'
export { recaptchaProvider } from './spam/providers/recaptcha'
export type { TurnstileProviderOptions } from './spam/providers/turnstile'
export { turnstileProvider } from './spam/providers/turnstile'
export { createKvRateLimiter } from './spam/rateLimiter'
export { resolveSpamConfig } from './spam/resolveSpam'
export type {
	CaptchaProvider,
	CaptchaVerifyArgs,
	IdentifyFn,
	RateLimitCheckArgs,
	RateLimitConfig,
	RateLimiter,
	RateLimitResult,
	SpamConfig,
	SpamMetadataConfig,
	SpamOption,
} from './spam/types'
export { hasVotedCookie, votedCookieName } from './submissions/votedCookie'
export { captureFileRef } from './uploads/captureFileRef'
export { formatBytes } from './uploads/formatBytes'
export { resolveFileRef } from './uploads/resolveFileRef'
export type { FileFieldConfig, FileRef, FileRefError } from './uploads/types'
export { defaultValidationRules, defaultValidationRulesByType } from './validation/builtin'
export { defineValidationRule } from './validation/defineValidationRule'
export type {
	ValidationRuleOption,
	ValidationRuleRegistry,
	ValidationRulesConfig,
} from './validation/registry'
export type {
	AnyValidationRuleDefinition,
	ValidationRuleDefinition,
	ValidationRuleResult,
	ValidationSeverity,
} from './validation/types'
export type { FormBuilderPluginOptions as PluginOptions }
