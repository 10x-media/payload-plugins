import { type Config, definePlugin } from 'payload'

import { registerTranslations } from './plugin/registerTranslations'
import { setFieldsRegistry } from './plugin/registry'
import type { TranslationsOption } from './translations'
import type {
	ColorGlobalConfig,
	EncryptedGlobalConfig,
	FieldsPluginRegistry,
	IconGlobalConfig,
} from './types'

export type FieldsPluginOptions = {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/fields/i18n`. Values win over
	 * the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	/** Global defaults for colorField(). Per-field options always win. */
	color?: ColorGlobalConfig
	/** Global defaults for iconField(). Per-field options always win. */
	icon?: IconGlobalConfig
	/** Global defaults for encryptedField(). Per-field options always win. */
	encrypted?: EncryptedGlobalConfig
}

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/fields': FieldsPluginOptions
	}
}

const normalizeRegistry = (options: FieldsPluginOptions): FieldsPluginRegistry => {
	const registry: FieldsPluginRegistry = {}
	if (options.color) {
		registry.color = options.color
	}
	if (options.icon) {
		registry.icon = options.icon
	}
	if (options.encrypted) {
		registry.encrypted = options.encrypted
	}
	return registry
}

/**
 * Fields plugin for Payload v3. Registers translations and writes global field
 * defaults to `config.custom['@10x-media/fields']` for factories, hooks, and
 * server components to read at runtime via `getFieldsRegistry`. Every field
 * factory also works without this plugin; per-field options always override
 * these defaults. Authored with `definePlugin` so sibling plugins can detect
 * it by slug.
 */
export const fields = definePlugin<FieldsPluginOptions>({
	slug: '@10x-media/fields',
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)
		setFieldsRegistry(config, normalizeRegistry(options))
		return config
	},
})

export { getFieldsRegistry } from './plugin/registry'
export type {
	ColorFormat,
	ColorGlobalConfig,
	ColorPreset,
	DecryptFailurePolicy,
	EncryptedGlobalConfig,
	FieldsPluginRegistry,
	FieldsResolverArgs,
	IconAdapter,
	IconGlobalConfig,
	IconManifest,
	IconMeta,
	KeysConfig,
} from './types'
export type { FieldsPluginOptions as PluginOptions }
