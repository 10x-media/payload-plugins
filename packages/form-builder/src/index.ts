import { type Config, definePlugin } from 'payload'
import { assertNoActionBlockCollision } from './actions/assertNoBlockCollision'
import { buildDefaultActionDefinitions } from './actions/builtin'
import { resolveActions } from './actions/registry'
import { assertNoCalcFunctionCollision } from './calc/registry'
import { stashConsentSources } from './consent/resolveConsentEntries'
import { buildDefaultFieldDefinitions } from './fields/builtin'
import { resolveFieldTypes, stashFieldTypes } from './fields/registry'
import type { FormBuilderPluginOptions } from './options'
import { registerCollections } from './plugin/registerCollections'
import { registerTranslations } from './plugin/registerTranslations'
import { readUploadCollectionMimeTypes } from './plugin/uploadsCollection'
import { resolvePollTypes, stashPollTypes } from './poll/pollTypeRegistry'
import { resolvePollOptionSources } from './poll/registry'
import { stashPollOptionSources } from './poll/resolvePollOptions'
import { resolveSpamConfig } from './spam/resolveSpam'
import { defaultValidationRules } from './validation/builtin'
import { resolveValidationRules } from './validation/registry'

export const formBuilder = definePlugin<FormBuilderPluginOptions>({
	slug: '@10x-media/form-builder',
	order: 50,
	plugin: ({ config, plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		const localizeContent = options.localizeContent !== false
		const uploads = options.uploads ?? false
		const calcSources = options.calc?.sources ?? {}
		const calcFunctions = options.calc?.functions ?? {}
		// Fail fast: the evaluator resolves built-ins first, so a colliding custom function could never run.
		assertNoCalcFunctionCollision(calcFunctions)
		// The allowed extension names, threaded into every normalizeCalc gate (the calculation field's
		// validate and the forms beforeValidate) so a stored expression can only ever reference a
		// registered source or function.
		const calcAllowed = {
			sources: new Set(Object.keys(calcSources)),
			functions: new Set(Object.keys(calcFunctions)),
		}
		// Serializable source metadata for the builder UI: key, label, and implemented modes. The
		// resolver functions themselves never leave the server.
		const calcSourceMeta = Object.entries(calcSources).map(([key, source]) => ({
			key,
			label: source.label,
			scalar: typeof source.resolve === 'function',
			weights: typeof source.resolveWeights === 'function',
		}))
		// The file field's MIME picker is constrained to what the host upload collection accepts: the
		// explicit `uploads.mimeTypes` override, else the collection's own `upload.mimeTypes`. Read here,
		// before the field registry freezes below (attachUploadsCollection runs too late).
		const uploadMimeTypes =
			uploads === false
				? undefined
				: (uploads.mimeTypes ?? readUploadCollectionMimeTypes(config, uploads.collection))
		const consentSources = options.consent?.sources
		// A built-in with nowhere to point never enters the registry, so an author is never offered a
		// field that cannot work: file without an uploads collection has nowhere to store anything,
		// consent without sources has no statement to reference. An explicit `fields.file` /
		// `fields.consent` definition remains a developer choice.
		const defaultFieldDefinitions = buildDefaultFieldDefinitions(
			localizeContent,
			options.richText?.editor,
			uploadMimeTypes,
			calcAllowed,
			calcSourceMeta
		).filter(
			(definition) =>
				(uploads !== false || definition.type !== 'file') &&
				(consentSources !== undefined || definition.type !== 'consent')
		)
		const registry = resolveFieldTypes(defaultFieldDefinitions, options.fields)
		const ruleRegistry = resolveValidationRules(defaultValidationRules, options.rules)
		const fromAddresses = options.email?.fromAddresses
		const departments = options.email?.departments
		const actionRegistry = resolveActions(
			buildDefaultActionDefinitions({
				localize: localizeContent,
				editor: options.richText?.bodyEditor ?? options.richText?.editor,
				fromAddresses,
				departments,
				recipients: options.email?.recipients,
				recipientSources: options.email?.recipientSources,
			}),
			options.actions
		)
		// Fail fast if a custom action type collides with a host block slug (Payload resolves blocks
		// globally by slug, which would silently merge the content block's fields into saved actions).
		assertNoActionBlockCollision(config, actionRegistry)
		const spam = resolveSpamConfig(options.spam)
		const pollSourceRegistry = resolvePollOptionSources(options.poll?.sources)
		const pollTypeRegistry = resolvePollTypes(options.poll?.types)
		// Stashed on config.custom so the root-level resolvePollOptions, resolveEffectivePollOptions,
		// resolvePollOutcome, and resolveConsentStatements helpers can reach these through
		// `payload.config` at request time, without threading plugin state through the host's own
		// server code. The field-type registry rides along so resolveEffectivePollOptions can look up a
		// results field's definition (and its `resolveOptions`) from a bare `payload` instance.
		config.custom = stashPollOptionSources(config.custom, pollSourceRegistry)
		config.custom = stashPollTypes(config.custom, pollTypeRegistry)
		config.custom = stashFieldTypes(config.custom, registry)
		if (consentSources) {
			config.custom = stashConsentSources(config.custom, consentSources)
		}
		registerTranslations(config, options.translations)
		registerCollections({
			config,
			registry,
			ruleRegistry,
			calcAllowed,
			calcSources,
			calcFunctions,
			consentSources,
			consentSnapshot: options.consent?.snapshot ?? 'both',
			consentResolveOnRead: options.consent?.resolveOnRead,
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
			pollTypeRegistry,
			outcomeFields: options.poll?.outcomeFields,
			pollVotes: options.poll?.votes === false ? false : (options.poll?.votes ?? {}),
			buttons: options.buttons,
			settings: options.settings,
			response: options.response,
			fromAddresses,
			departments,
			redirectRelationships: options.redirectRelationships,
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
export type {
	RecipientResolveArgs,
	RecipientSource,
	RecipientSourceRegistry,
} from './actions/recipientSources'
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
export type { CalcResolved } from './calc/evaluate'
export { calcWeightKey, evaluateCalc } from './calc/evaluate'
export { formatCalc } from './calc/formatCalc'
export type { CalcDisplayConfig } from './calc/formatCalcValue'
export { formatCalcValue } from './calc/formatCalcValue'
export type { CalcAllowed } from './calc/normalizeCalc'
export { normalizeCalc } from './calc/normalizeCalc'
export type {
	CalcFunction,
	CalcSource,
	CalcSourceResolveArgs,
	CalcWeightResolveArgs,
} from './calc/registry'
export { defineCalcFunction, defineCalcSource } from './calc/registry'
export type { ResolveCalcContextArgs } from './calc/resolveCalcContext'
export { calcUsesSources, resolveCalcContext } from './calc/resolveCalcContext'
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
export type {
	RedirectFieldsOverride,
	RedirectOption,
	ResponseOption,
} from './collections/redirectFields'
export type {
	DefaultSettingsFields,
	SettingsFieldsOverride,
	SettingsOption,
} from './collections/settingsFields'
export { buildDefaultSettingsFields } from './collections/settingsFields'
export { evaluateCondition } from './conditions/evaluate'
export type { FieldCondition } from './conditions/types'
export { applyConsentStatements } from './consent/applyConsentStatements'
export type { ConsentProof, ConsentSnapshotMode } from './consent/captureConsent'
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
export type { FormContextReference } from './context/formContext'
export { signFormContext, verifyFormContext } from './context/formContext'
export type {
	DepartmentEmailsResolver,
	DepartmentOption,
	ResolveDepartmentOptionsArgs,
	ResolveDepartmentsRequestArgs,
	ResolveDepartmentsRequestResult,
} from './email/departments'
export { resolveDepartmentOptions } from './email/departments'
export type { DepartmentsFieldOptions } from './email/departmentsField'
export { departmentsField } from './email/departmentsField'
export {
	buildDefaultFieldDefinitions,
	defaultFieldDefinitions,
	defaultFieldDefinitionsByType,
} from './fields/builtin'
export { countryField } from './fields/builtin/country'
export { fileMimeTypeOptions } from './fields/builtin/file'
export { stateField } from './fields/builtin/state'
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
export type {
	FormBuilderPluginOptions,
	FormBuilderPluginOptions as PluginOptions,
} from './options'
export type { UploadsOption } from './plugin/uploadsCollection'
export type { PollCloseTaskInput } from './poll/closeJob'
export {
	buildPollCloseTask,
	enqueuePollClose,
	POLL_CLOSE_TASK_SLUG,
	registerPollCloseTask,
	runPollClose,
	shouldAutoResolvePoll,
} from './poll/closeJob'
export type {
	AnyPollOptionSource,
	PollOption,
	PollOptionResolveArgs,
	PollOptionSource,
} from './poll/definePollOptionSource'
export { definePollOptionSource } from './poll/definePollOptionSource'
export type { PollOutcomeStrategy, PollOutcomeStrategyArgs } from './poll/definePollType'
export { definePollType } from './poll/definePollType'
export type { ResolveEffectivePollOptionsArgs } from './poll/effectivePollOptions'
export { resolveEffectivePollOptions } from './poll/effectivePollOptions'
export { mostVotedStrategy, topBucketValues } from './poll/mostVoted'
export type { DefaultOutcomeFields, OutcomeFieldsOverride } from './poll/outcomeFields'
export {
	buildDefaultOutcomeFields,
	buildResolvedAtField,
	buildWinningValuesField,
} from './poll/outcomeFields'
export type { PollTypeRegistry, PollTypesConfig } from './poll/pollTypeRegistry'
export {
	manualStrategy,
	pollTypesOf,
	resolvePollTypes,
	sourceStrategy,
	stashPollTypes,
} from './poll/pollTypeRegistry'
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
export { aggregateFromVotes } from './poll/votes/aggregateFromVotes'
export { recountPollVotes } from './poll/votes/recountPollVotes'
export { POLL_VOTES_SLUG, RESPONDENTS_VALUE, VOTE_SHARDS } from './poll/votes/votesCollection'
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
export type { CreatedSubmission, CreateSubmissionArgs } from './submissions/createSubmission'
export { createSubmission } from './submissions/createSubmission'
export { hasVotedCookie, votedCookieName } from './submissions/votedCookie'
export { captureFileRef } from './uploads/captureFileRef'
export { formatBytes } from './uploads/formatBytes'
export { resolveFileRef } from './uploads/resolveFileRef'
export type { FileFieldConfig, FileRef, FileRefError } from './uploads/types'
export { defaultValidationRules, defaultValidationRulesByType } from './validation/builtin'
export { defineValidationRule } from './validation/defineValidationRule'
export type { FieldTargetParamOptions } from './validation/fieldTargetParam'
export { fieldTargetParam } from './validation/fieldTargetParam'
export type {
	ValidationRuleOption,
	ValidationRuleRegistry,
	ValidationRulesConfig,
} from './validation/registry'
export type {
	AnyValidationRuleDefinition,
	ValidationRuleDefinition,
	ValidationRuleResult,
} from './validation/types'
