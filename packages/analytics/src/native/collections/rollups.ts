import type { CollectionConfig, Field } from 'payload'

export const ROLLUPS_SLUG = 'analytics-rollups'

/**
 * `hostname` ('' = the hostname-less family) is part of the unique bucket on every
 * native install: unfiltered reads hit the '' family and hostname-scoped reads hit the
 * exact-hostname family, both kept per-bucket exact by dual emission in computeRollupDeltas.
 * Scoped installs add a further required scope key ('' = the null scope) to every rollup
 * row and to the unique bucket index, so each scope accumulates its own buckets.
 * Existing native installs need a migration for the new hostname column (and, if
 * enabling scope, the scope column too).
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
		{ name: 'hostname', type: 'text', required: true, defaultValue: '' },
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
					fields: ['granularity', 'period', 'path', 'dimension', 'dimvalue', 'hostname', 'scope'],
					unique: true,
				}
			: {
					fields: ['granularity', 'period', 'path', 'dimension', 'dimvalue', 'hostname'],
					unique: true,
				},
	],
})
