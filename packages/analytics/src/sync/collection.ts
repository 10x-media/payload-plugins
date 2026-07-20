import type { CollectionConfig, Field } from 'payload'

export const SYNC_DEFAULT_SLUG = 'analytics-daily'

export const METRIC_FIELDS = [
	'pageviews',
	'visitors',
	'sessions',
	'avgDuration',
	'bounceRate',
	'events',
] as const

export type SyncMetric = (typeof METRIC_FIELDS)[number]

/**
 * The sync tier's queryable collection: one row per (source, date) of a provider's daily
 * metrics. It is read-only and machine-written (writes are locked to the sync job, which
 * uses overrideAccess), and hidden from the admin nav by default because it is a query
 * substrate for custom reporting rather than something to browse and edit; pass
 * `sync: { hidden: false }` to surface it. `admin.hidden` only hides the nav entry, so
 * the collection stays fully queryable through the REST/local API either way. The unique
 * (source, date) index makes re-syncs idempotent and is cross-DB clean (both key columns
 * are required, so NOT NULL on Postgres, which would otherwise treat repeated rows as
 * distinct). Metric fields are nullable so a provider that omits a metric is
 * distinguishable from a real zero.
 */
export const syncCollection = (slug: string, hidden = true): CollectionConfig => ({
	slug,
	admin: {
		hidden,
		useAsTitle: 'source',
		defaultColumns: ['source', 'date', 'pageviews', 'visitors'],
	},
	access: {
		read: ({ req }) => Boolean(req.user),
		create: () => false,
		update: () => false,
		delete: () => false,
	},
	fields: [
		{ name: 'source', type: 'text', required: true, index: true },
		{ name: 'date', type: 'date', required: true, index: true },
		...METRIC_FIELDS.map((name): Field => ({ name, type: 'number' })),
		{ name: 'syncedAt', type: 'date' },
	],
	indexes: [{ fields: ['source', 'date'], unique: true }],
})
