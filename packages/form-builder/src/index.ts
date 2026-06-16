import { type Config, definePlugin } from 'payload'
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
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/form-builder': FormBuilderPluginOptions
	}
}

export const formBuilder = definePlugin<FormBuilderPluginOptions>({
	slug: '@10x-media/form-builder',
	order: 50,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		const registry = resolveFieldTypes(defaultFieldDefinitions, options.fields)
		const ruleRegistry = resolveValidationRules(defaultValidationRules, options.rules)
		const presentationRegistry = resolvePresentationDescriptors(
			defaultPresentationDescriptors,
			options.presentations
		)
		registerTranslations(config)
		registerCollections({ config, registry, ruleRegistry, presentationRegistry })
		return config
	},
})

export { evaluateCondition } from './conditions/evaluate'
export type { FieldCondition } from './conditions/types'
export { defineFormField } from './fields/defineFormField'
export type { FieldTypeOption, FieldTypeRegistry, FieldTypesConfig } from './fields/registry'
export type {
	AnyFormFieldDefinition,
	FormFieldDefinition,
	FormFieldFormat,
	FormFieldValidate,
	FormFieldValueKind,
} from './fields/types'
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
