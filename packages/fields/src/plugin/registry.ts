import type { Config, SanitizedConfig } from 'payload'

import type { FieldsPluginRegistry } from '../types'

const REGISTRY_KEY = '@10x-media/fields'

/** Write the normalized plugin registry onto the incoming config. */
export const setFieldsRegistry = (config: Config, registry: FieldsPluginRegistry): void => {
	config.custom ??= {}
	config.custom[REGISTRY_KEY] = registry
}

/** Read plugin-registered defaults at runtime (undefined when the plugin did not run). */
export const getFieldsRegistry = (config: SanitizedConfig): FieldsPluginRegistry | undefined =>
	(config.custom as Record<string, FieldsPluginRegistry | undefined> | undefined)?.[REGISTRY_KEY]
