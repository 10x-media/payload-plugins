import type { Config } from 'payload'

/**
 * The folders collection Payload adds while sanitizing, after every plugin has run, or `null`
 * when no collection uses folders. Plugins never see it in `config.collections`, so scope checks
 * and pickers name it through this.
 */
export const foldersSlugOf = (config: Pick<Config, 'collections' | 'folders'>): string | null =>
	config.folders !== false &&
	(config.collections ?? []).some((collection) => Boolean(collection.folders))
		? (config.folders?.slug ?? 'payload-folders')
		: null
