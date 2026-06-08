import type { CollectionConfig } from 'payload'

export const ROLLUPS_SLUG = 'analytics-rollups'

export const rollupsCollection = (): CollectionConfig => ({
	slug: ROLLUPS_SLUG,
	admin: { hidden: true },
	access: { read: () => false, create: () => true, update: () => true, delete: () => true },
	fields: [
		{ name: 'granularity', type: 'text', required: true },
		{ name: 'period', type: 'date', required: true, index: true },
		{ name: 'path', type: 'text', required: true, index: true },
		{ name: 'dimension', type: 'text', required: true, defaultValue: '' },
		{ name: 'dimvalue', type: 'text', required: true, defaultValue: '' },
		{ name: 'pageviews', type: 'number', required: true, defaultValue: 0 },
		{ name: 'events', type: 'number', required: true, defaultValue: 0 },
		{ name: 'durationMs', type: 'number', required: true, defaultValue: 0 },
		{ name: 'samples', type: 'number', required: true, defaultValue: 0 },
	],
	indexes: [{ fields: ['granularity', 'period', 'path', 'dimension', 'dimvalue'], unique: true }],
})
