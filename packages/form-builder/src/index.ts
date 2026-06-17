import { type Config, definePlugin } from 'payload'
import { defaultActionDefinitions } from './actions/builtin'
import type { ActionsConfig } from './actions/registry'
import { resolveActions } from './actions/registry'
import { defaultConsentSources } from './consent/builtin'
import type { ConsentSourcesConfig } from './consent/registry'
import { resolveConsentSources } from './consent/registry'
import type { FormEventSink } from './events/types'
import { defaultFieldDefinitions } from './fields/builtin'
import { type FieldTypesConfig, resolveFieldTypes } from './fields/registry'
import { registerCollections } from './plugin/registerCollections'
import { registerTranslations } from './plugin/registerTranslations'
import { defaultPresentationDescriptors } from './presentations/defaults'
import type { PresentationsDescriptorConfig } from './presentations/registry'
import { resolvePresentationDescriptors } from './presentations/registry'
import { defaultValidationRules } from './validation/builtin'
import { resolveValidationRules, type ValidationRulesConfig } from './validation/registry'

export type FormBuilderPluginOptions = {
	disabled?: boolean
	/** Pluggable sink for form lifecycle events. Defaults to a no-op; analytics adapters or a future analytics plugin subscribe here. */
	events?: FormEventSink
	/** Add, override, or remove field types. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	fields?: FieldTypesConfig
	/** Add, override, or remove presentations. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	presentations?: PresentationsDescriptorConfig
	/** Add, override, or remove validation rule types. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	rules?: ValidationRulesConfig
	/** Add, override, or remove post-submit action types. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	actions?: ActionsConfig
	/** Add, override, or remove consent source types. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	consentSources?: ConsentSourcesConfig
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
		const registry = resolveFieldTypes(defaultFieldDefinitions, options.fields)
		const ruleRegistry = resolveValidationRules(defaultValidationRules, options.rules)
		const consentRegistry = resolveConsentSources(defaultConsentSources, options.consentSources)
		const presentationRegistry = resolvePresentationDescriptors(
			defaultPresentationDescriptors,
			options.presentations
		)
		const actionRegistry = resolveActions(defaultActionDefinitions, options.actions)
		registerTranslations(config)
		registerCollections({
			config,
			registry,
			ruleRegistry,
			consentRegistry,
			presentationRegistry,
			actionRegistry,
			hasJobsPlugin: Boolean(plugins['@10x-media/jobs']),
			events: options.events,
		})
		return config
	},
})

export { defaultActionDefinitions } from './actions/builtin'
export type { ActionDefinition, ActionRunArgs, AnyActionDefinition } from './actions/defineAction'
export { defineAction } from './actions/defineAction'
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
export { evaluateCondition } from './conditions/evaluate'
export type { FieldCondition } from './conditions/types'
export { defaultConsentSources } from './consent/builtin'
export type { ConsentProof } from './consent/captureConsent'
export { captureConsent } from './consent/captureConsent'
export type {
	AnyConsentSource,
	ConsentLink,
	ConsentResolveArgs,
	ConsentResolved,
	ConsentSource,
} from './consent/defineConsentSource'
export { defineConsentSource } from './consent/defineConsentSource'
export type {
	ConsentSourceOption,
	ConsentSourceRegistry,
	ConsentSourcesConfig,
} from './consent/registry'
export { resolveConsentSources } from './consent/registry'
export { resolveConsentLinks } from './consent/resolveConsentLinks'
export { resolvePublishedVersionRef } from './consent/resolvePublishedVersionRef'
export { defineFormField } from './fields/defineFormField'
export type { FieldTypeOption, FieldTypeRegistry, FieldTypesConfig } from './fields/registry'
export type {
	AnyFormFieldDefinition,
	FormFieldDefinition,
	FormFieldFormat,
	FormFieldValidate,
	FormFieldValueKind,
} from './fields/types'
export type { PrefillOptions } from './prefill/valuesFromSearchParams'
export { valuesFromSearchParams } from './prefill/valuesFromSearchParams'
export { DEFAULT_PRESENTATION_NAME, defaultPresentationDescriptors } from './presentations/defaults'
export type {
	PresentationDescriptorOption,
	PresentationDescriptorRegistry,
	PresentationsDescriptorConfig,
} from './presentations/registry'
export { resolvePresentationDescriptors } from './presentations/registry'
export type {
	PresentationDensity,
	PresentationDescriptor,
	PresentationSurface,
} from './presentations/types'
export { interpolate } from './recall/interpolate'
export type { RecallResolver } from './recall/resolver'
export { buildRecallResolver, optionLabelsFor } from './recall/resolver'
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
