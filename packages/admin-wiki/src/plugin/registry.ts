import type { Config, SanitizedConfig } from 'payload'

import type { ResolvedWikiOptions } from './resolveOptions'

/** `config.custom` key the plugin's resolved options live under. */
export const ADMIN_WIKI_REGISTRY_KEY = '@10x-media/admin-wiki'

/**
 * Runtime-readable registry: the resolved options plus config-derived data the
 * plugin's endpoints and server components need after sanitization.
 */
export type AdminWikiRegistry = ResolvedWikiOptions & {
	/** Target keys resolving against the walked config, for orphan detection. */
	validTargetKeys: string[]
}

/** Write the resolved plugin options onto the incoming config. */
export const setWikiRegistry = (config: Config, registry: AdminWikiRegistry): void => {
	config.custom ??= {}
	config.custom[ADMIN_WIKI_REGISTRY_KEY] = registry
}

/** Read the resolved plugin options at runtime (undefined when the plugin did not run). */
export const getWikiRegistry = (
	config: Pick<Config | SanitizedConfig, 'custom'>
): AdminWikiRegistry | undefined =>
	(config.custom as Record<string, AdminWikiRegistry | undefined> | undefined)?.[
		ADMIN_WIKI_REGISTRY_KEY
	]
