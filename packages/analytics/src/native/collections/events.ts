import type { CollectionConfig, Field } from 'payload'

export const EVENTS_SLUG = 'analytics-events'

/**
 * The scope column exists only for scoped installs (a configured scopeResolver);
 * enabling scope on an existing native install therefore needs a migration adding
 * the column to events and rollups.
 */
export const eventsCollection = (scoped = false): CollectionConfig => ({
	slug: EVENTS_SLUG,
	admin: { hidden: true },
	access: { read: () => false, create: () => true, update: () => false, delete: () => false },
	fields: [
		{ name: 'timestamp', type: 'date', required: true, index: true },
		{ name: 'type', type: 'select', required: true, options: ['pageview', 'event'], index: true },
		{ name: 'name', type: 'text' },
		{ name: 'path', type: 'text', required: true, index: true },
		{ name: 'hostname', type: 'text', required: true },
		{ name: 'referrer', type: 'text' },
		{ name: 'device', type: 'text' },
		{ name: 'source', type: 'text' },
		{ name: 'country', type: 'text' },
		{ name: 'region', type: 'text' },
		{ name: 'city', type: 'text' },
		{ name: 'visitorHash', type: 'text', required: true, index: true },
		{ name: 'sessionId', type: 'text', required: true, index: true },
		{ name: 'durationMs', type: 'number' },
		{ name: 'props', type: 'json' },
		...(scoped ? [{ name: 'scope', type: 'text', index: true } satisfies Field] : []),
	],
	indexes: [{ fields: ['path', 'timestamp'] }, { fields: ['type', 'timestamp'] }],
})
