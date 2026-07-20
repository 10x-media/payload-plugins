import type { Config, SanitizedConfig } from 'payload'

import type { FieldsPluginRegistry } from '../types'

/** `config.custom` key the plugin's normalized options live under. */
export const FIELDS_REGISTRY_KEY = '@10x-media/fields'

/** Write the normalized plugin registry onto the incoming config. */
export const setFieldsRegistry = (config: Config, registry: FieldsPluginRegistry): void => {
	config.custom ??= {}
	config.custom[FIELDS_REGISTRY_KEY] = registry
}

/** Read plugin-registered defaults at runtime (undefined when the plugin did not run). */
export const getFieldsRegistry = (config: SanitizedConfig): FieldsPluginRegistry | undefined =>
	(config.custom as Record<string, FieldsPluginRegistry | undefined> | undefined)?.[
		FIELDS_REGISTRY_KEY
	]
