import type { CollectionConfig, Field, TextFieldSingleValidation } from 'payload'
import type { ProviderAccessArgs } from '../providers/access'
import { providerRowAccess } from '../providers/access'

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
 * (source, date, scope) index makes re-syncs idempotent and is cross-DB clean (all key
 * columns are required, so NOT NULL on Postgres, which would otherwise treat repeated rows
 * as distinct). Metric fields are nullable so a provider that omits a metric is
 * distinguishable from a real zero. Read access reuses `providerRowAccess`: unscoped
 * installs keep the any-authenticated-user behavior, scoped installs constrain reads to the
 * request's resolved scope (or lift the constraint for a platform-read grant). Writes stay
 * locked to the sync job, which writes with `overrideAccess: true`.
 */
export const syncCollection = (
	slug: string,
	hidden: boolean,
	access: ProviderAccessArgs
): CollectionConfig => ({
	slug,
	admin: {
		hidden,
		useAsTitle: 'source',
		defaultColumns: ['source', 'date', 'pageviews', 'visitors'],
	},
	access: {
		read: providerRowAccess(access),
		create: () => false,
		update: () => false,
		delete: () => false,
	},
	fields: [
		{ name: 'source', type: 'text', required: true, index: true },
		{ name: 'date', type: 'date', required: true, index: true },
		{
			name: 'scope',
			type: 'text',
			required: true,
			defaultValue: '',
			index: true,
			// '' is the deliberate sentinel for "no scope"; Payload's default text
			// validator treats it as failing `required`, so accept any string.
			validate: ((value) =>
				typeof value === 'string' ? true : 'invalid scope') as TextFieldSingleValidation,
		},
		...METRIC_FIELDS.map((name): Field => ({ name, type: 'number' })),
		{ name: 'syncedAt', type: 'date' },
	],
	indexes: [{ fields: ['source', 'date', 'scope'], unique: true }],
})
