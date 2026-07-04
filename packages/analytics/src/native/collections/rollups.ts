import type { CollectionConfig, Field } from 'payload'

export const ROLLUPS_SLUG = 'analytics-rollups'

/**
 * Scoped installs add a required scope key ('' = the null scope) to every rollup
 * row and to the unique bucket index, so each scope accumulates its own buckets.
 * Existing native installs enabling scope need a migration for the new column.
 */
export const rollupsCollection = (scoped = false): CollectionConfig => ({
	slug: ROLLUPS_SLUG,
	admin: { hidden: true },
	access: { read: () => false, create: () => true, update: () => true, delete: () => true },
	fields: [
		{ name: 'granularity', type: 'text', required: true },
		{ name: 'period', type: 'date', required: true, index: true },
		{ name: 'path', type: 'text', required: true, index: true },
		{ name: 'dimension', type: 'text', required: true, defaultValue: '' },
		{ name: 'dimvalue', type: 'text', required: true, defaultValue: '' },
		...(scoped
			? [
					{
						name: 'scope',
						type: 'text',
						required: true,
						defaultValue: '',
						index: true,
					} satisfies Field,
				]
			: []),
		{ name: 'pageviews', type: 'number', required: true, defaultValue: 0 },
		{ name: 'events', type: 'number', required: true, defaultValue: 0 },
		{ name: 'durationMs', type: 'number', required: true, defaultValue: 0 },
		{ name: 'visitors', type: 'number', required: true, defaultValue: 0 },
		{ name: 'sessions', type: 'number', required: true, defaultValue: 0 },
		{ name: 'samples', type: 'number', required: true, defaultValue: 0 },
	],
	indexes: [
		scoped
			? {
					fields: ['granularity', 'period', 'path', 'dimension', 'dimvalue', 'scope'],
					unique: true,
				}
			: { fields: ['granularity', 'period', 'path', 'dimension', 'dimvalue'], unique: true },
	],
})
