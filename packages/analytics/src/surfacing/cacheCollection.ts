import type { CollectionConfig } from 'payload'

/** The read cache's slug, unless `cache.collection.slug` names another. */
export const CACHE_SLUG = 'analytics-cache'

const nobody = (): boolean => false

/**
 * The read cache, one row per key, reached only through `payload.db`. On MongoDB `staleUntil` has
 * no Payload index, which would conflict with the TTL index the plugin creates on it.
 */
export const cacheCollection = (args: { slug: string; mongo: boolean }): CollectionConfig => ({
	slug: args.slug,
	admin: { hidden: true },
	access: { read: nobody, create: nobody, update: nobody, delete: nobody },
	endpoints: false,
	graphQL: false,
	timestamps: false,
	lockDocuments: false,
	fields: [
		{ name: 'key', type: 'text', required: true, unique: true, index: true },
		{ name: 'value', type: 'json', required: true },
		{ name: 'owner', type: 'text' },
		{ name: 'fetchedAt', type: 'date', required: true },
		{ name: 'expiresAt', type: 'date', required: true },
		{ name: 'staleUntil', type: 'date', required: true, ...(args.mongo ? {} : { index: true }) },
		{ name: 'readAt', type: 'date', index: true },
		{ name: 'recipe', type: 'json' },
	],
})
