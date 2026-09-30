import type { CollectionConfig, Config, GlobalConfig } from 'payload'

import type { ResolvedOptions } from '../options'
import { foldersSlugOf } from '../plugin/foldersSlug'
import { collectionGuard, globalGuard } from './guard'
import { retryAfterHook } from './retryAfter'
import { wrapAccess } from './wrapAccess'

/**
 * Whether a collection or global exempts itself from every lock, for plugins
 * and projects that own collections which must stay writable (logs, queues,
 * submissions) without every consumer listing them in `exempt`.
 */
export const isMarkedExempt = (entity: { custom?: Record<string, unknown> }): boolean =>
	(entity.custom?.contentLock as { exempt?: unknown } | undefined)?.exempt === true

/** Guard plus access wrapping for one collection. */
export const lockCollection = (collection: CollectionConfig): CollectionConfig => {
	const entity = { type: 'collection', slug: collection.slug } as const
	return {
		...collection,
		access: {
			...collection.access,
			create: wrapAccess(collection.access?.create, entity),
			update: wrapAccess(collection.access?.update, entity),
			delete: wrapAccess(collection.access?.delete, entity),
		},
		hooks: {
			...collection.hooks,
			beforeOperation: [
				collectionGuard(collection.slug),
				...(collection.hooks?.beforeOperation ?? []),
			],
		},
	}
}

/** Guard plus access wrapping for one global. */
export const lockGlobal = (global: GlobalConfig): GlobalConfig => {
	const entity = { type: 'global', slug: global.slug } as const
	return {
		...global,
		access: { ...global.access, update: wrapAccess(global.access?.update, entity) },
		hooks: {
			...global.hooks,
			beforeOperation: [globalGuard(global.slug), ...(global.hooks?.beforeOperation ?? [])],
		},
	}
}

/**
 * Freeze every non-exempt collection and global, including the folders
 * collection Payload adds after plugins run, and add `Retry-After` to lock
 * rejections.
 */
export const registerEnforcement = (config: Config, options: ResolvedOptions): void => {
	const exempt = new Set(options.exempt)
	config.collections = (config.collections ?? []).map((collection) =>
		exempt.has(collection.slug) ? collection : lockCollection(collection)
	)
	config.globals = (config.globals ?? []).map((global) =>
		exempt.has(global.slug) ? global : lockGlobal(global)
	)
	if (config.folders !== false && foldersSlugOf(config)) {
		config.folders = {
			...config.folders,
			collectionOverrides: [
				...(config.folders?.collectionOverrides ?? []),
				({ collection }) =>
					exempt.has(collection.slug) || isMarkedExempt(collection)
						? collection
						: lockCollection(collection),
			],
		}
	}
	config.hooks = {
		...config.hooks,
		afterError: [...(config.hooks?.afterError ?? []), retryAfterHook(options.retryAfter)],
	}
}
