import { type Config, definePlugin } from 'payload'

import { validateEncryptedBoot } from './fields/encrypted/boot'
import {
	withEncryptedQueryRewrite,
	withEncryptedResponseStrip,
} from './fields/encrypted/queryRewrite'
import { registerIcon } from './fields/icon/plugin'
import { resolvePrecision } from './fields/measurement/engine/precision'
import { FLAGS_ENDPOINT_PATH, makeFlagsHandler } from './fields/phoneNumber/server/flagsEndpoint'
import { registerTranslations } from './plugin/registerTranslations'
import { setFieldsRegistry } from './plugin/registry'
import type { TranslationsOption } from './translations'
import type {
	ColorGlobalConfig,
	EncryptedGlobalConfig,
	FieldsPluginRegistry,
	IconGlobalConfig,
	MeasurementGlobalConfig,
	PhoneNumberGlobalConfig,
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
	/** Global defaults for measurementField(). Per-field options always win. */
	measurement?: MeasurementGlobalConfig
	/** Global defaults for phoneNumberField(). Per-field options always win. */
	phoneNumber?: PhoneNumberGlobalConfig
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
	// registry.icon is owned solely by registerIcon, which validates adapter
	// slugs and the default library before writing the normalized slice.
	if (options.encrypted) {
		registry.encrypted = options.encrypted
	}
	if (options.measurement) {
		// Fails fast at plugin build, before any field's beforeValidate hook can run
		// against it, instead of throwing on every write once the app is live.
		if (options.measurement.precision !== undefined) {
			try {
				resolvePrecision([options.measurement.precision])
			} catch (error) {
				throw new Error(
					`fields plugin: measurement.precision is invalid: ${(error as Error).message}`
				)
			}
		}
		registry.measurement = options.measurement
	}
	if (options.phoneNumber) {
		const { countries, defaultCountry, metadata, validation } = options.phoneNumber
		if (validation === 'mobile' && metadata === 'min') {
			throw new Error(
				"fields plugin: phoneNumber.validation 'mobile' needs metadata 'max' or 'mobile'; 'min' carries no number types."
			)
		}
		if (defaultCountry && countries && !countries.includes(defaultCountry)) {
			throw new Error(
				`fields plugin: phoneNumber.defaultCountry "${defaultCountry}" is not in phoneNumber.countries.`
			)
		}
		registry.phoneNumber = options.phoneNumber
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
		// Sole owner of registry.icon: validates adapters + default library and
		// registers their client components in admin.dependencies. A no-op when no
		// adapters are configured, leaving registry.icon unset.
		registerIcon(config, options.icon)
		config.admin = config.admin ?? {}
		config.admin.components = config.admin.components ?? {}
		config.admin.components.providers = config.admin.components.providers ?? []
		config.admin.components.providers.push({
			clientProps: { persist: options.measurement?.persistPreferences !== false },
			path: '@10x-media/fields/client#MeasurementUnitsProvider',
		})
		// Gated on serveFlags, not the resolved `flags` value: flags is per-field and
		// unknown until fields exist, so a field overriding to 'svg' would break under a gated install.
		if (options.phoneNumber?.serveFlags !== false) {
			config.endpoints = [
				...(config.endpoints ?? []),
				{ handler: makeFlagsHandler(), method: 'get', path: FLAGS_ENDPOINT_PATH },
			]
		}
		// Transparently rewrite equals/in on queryable encrypted fields to their
		// blind-index siblings; a no-op for collections that have none. Globals
		// take no where, so they get the response strip alone.
		config.collections = (config.collections ?? []).map(withEncryptedQueryRewrite)
		config.globals = (config.globals ?? []).map(withEncryptedResponseStrip)
		// Validate encrypted key material at boot, before any prior onInit runs, so
		// missing secrets or broken providers fail fast instead of on first write.
		const priorOnInit = config.onInit
		config.onInit = async (payload) => {
			await validateEncryptedBoot(payload, options.encrypted?.keys)
			await priorOnInit?.(payload)
		}
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
	IconCanvas,
	IconGlobalConfig,
	IconLayer,
	IconLayerCache,
	IconLayerContext,
	IconManifest,
	IconMeta,
	IconRenderStrategy,
	KeysConfig,
	MeasurementDefaultUnitsResolver,
	MeasurementGlobalConfig,
	PhoneNumberGlobalConfig,
} from './types'
export type { FieldsPluginOptions as PluginOptions }
