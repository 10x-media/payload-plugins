import { type Config, definePlugin } from 'payload'
import type { FormEventSink } from './events/types'
import { defaultFieldDefinitions } from './fields/builtin'
import { type FieldTypesConfig, resolveFieldTypes } from './fields/registry'
import { registerCollections } from './plugin/registerCollections'
import { registerTranslations } from './plugin/registerTranslations'

export type FormBuilderPluginOptions = {
	disabled?: boolean
	/** Pluggable sink for form lifecycle events. Defaults to a no-op; analytics adapters or a future analytics plugin subscribe here. */
	events?: FormEventSink
	/** Add, override, or remove field types. `false` removes a built-in, `true` keeps it, an object adds or replaces one. */
	fields?: FieldTypesConfig
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
		registerTranslations(config)
		registerCollections(config, registry)
		return config
	},
})

export { defineFormField } from './fields/defineFormField'
export type { FieldTypeOption, FieldTypeRegistry, FieldTypesConfig } from './fields/registry'
export type {
	AnyFormFieldDefinition,
	FormFieldDefinition,
	FormFieldFormat,
	FormFieldValidate,
	FormFieldValueKind,
} from './fields/types'
export type { FormBuilderPluginOptions as PluginOptions }
