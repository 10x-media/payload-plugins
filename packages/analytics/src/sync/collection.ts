import type {
	Access,
	CollectionConfig,
	Field,
	PayloadRequest,
	TextFieldSingleValidation,
} from 'payload'
import { type ProviderAccessArgs, providerRowAccess } from '../providers/access'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { builtInStaticLabel, type StaticLabelFor } from '../translations/staticLabel'

/** The sync collection's slug unless `sync.collection.slug` names another. */
export const SYNC_SLUG = 'analytics-daily'

export const METRIC_FIELDS = [
	'pageviews',
	'visitors',
	'sessions',
	'avgDuration',
	'visitDuration',
	'bounceRate',
	'events',
] as const

export type SyncMetric = (typeof METRIC_FIELDS)[number]

export type SyncCollectionArgs = {
	hidden: boolean
	access: ProviderAccessArgs
	/** `access.read`, which every analytics read passes first, these rows included. */
	read: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
	/** The install's static labels; the built-in strings alone when absent. */
	staticLabel?: StaticLabelFor
}

/**
 * '' is the deliberate sentinel for "no scope"; Payload's default text validator treats it as
 * failing `required`, so any string passes.
 */
const validateScope: TextFieldSingleValidation = (value) =>
	typeof value === 'string' ? true : 'invalid scope'

/** The rows `access.read` and the scope's row access both let the request read. */
const syncReadAccess = (args: SyncCollectionArgs): Access => {
	const rows = providerRowAccess(args.access)
	return async (accessArgs) =>
		(await args.read({ req: accessArgs.req })) ? rows(accessArgs) : false
}

/**
 * One machine-written row per (source, date, scope) of a provider's daily metrics, hidden from the
 * nav but queryable; readers pass `access.read`, then the scope's row access.
 */
export const syncCollection = (slug: string, args: SyncCollectionArgs): CollectionConfig => ({
	slug,
	labels: {
		singular: labelForKey(keys.syncCollectionSingular),
		plural: labelForKey(keys.syncCollectionPlural),
	},
	admin: {
		hidden: args.hidden,
		group: (args.staticLabel ?? builtInStaticLabel)(keys.adminGroup),
		useAsTitle: 'source',
		defaultColumns: ['source', 'date', 'pageviews', 'visitors'],
	},
	access: {
		read: syncReadAccess(args),
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
			validate: validateScope,
		},
		...METRIC_FIELDS.map((name): Field => ({ name, type: 'number' })),
		{ name: 'syncedAt', type: 'date' },
	],
	indexes: [{ fields: ['source', 'date', 'scope'], unique: true }],
})
