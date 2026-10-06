import type { Access, CollectionConfig, CollectionSlug, PayloadRequest } from 'payload'

import type { DedupeEventSink } from './plugin/events'
import type { MergeFieldSpec } from './schema/types'
import type { DedupeAdapterFactory } from './search/contract'
import type { TranslationsOption } from './translations'

/** Built-in comparison presets. Each one also defines the blocking keys it emits. */
export type ComparePreset = 'date' | 'exact' | 'number' | 'phone' | 'text'

/**
 * A custom comparison. `keys` must be a pure function of one value so both sides of a
 * pair land in the same bucket; `similarity` is 0..1, where 1 is a match.
 */
export type CompareFn = {
	keys: (value: unknown) => string[]
	similarity: (a: unknown, b: unknown) => number
}

export type MatchFieldConfig = {
	/** Dot path of the field, as in the derived merge spec. */
	path: string
	/** Contribution of a match, on the same scale as the other fields. */
	weight: number
	/** Defaults to `exact`. */
	compare?: ComparePreset | CompareFn
	/**
	 * Applied when both sides have a value and they differ. A number is added to the raw
	 * score (usually negative); `veto` zeroes the pair whatever the other fields say.
	 * Defaults to minus a quarter of `weight`.
	 */
	onDiffer?: number | 'veto'
	/** Set `false` to score on this field without blocking on it. */
	key?: boolean
	/**
	 * With `compare: 'number'`: how far apart two values may be and still count as similar, in
	 * percent. Inside it the closer value scores higher. Default 0, equal values only.
	 */
	tolerance?: number
	/**
	 * With `compare: 'number'`: what `tolerance` measures. `value`, the difference against the
	 * larger value (100 and 104 are 4% apart); `quantity`, the share of characters that differ
	 * (1234567890 and 1234567891 are 10% apart). Default `value`.
	 */
	toleranceType?: 'value' | 'quantity'
}

export type MatchConfig = {
	fields: MatchFieldConfig[]
	/** Pairs scoring below this are not stored. Default 0.35. */
	minScore?: number
	/** Buckets larger than this are skipped by the scan; a key that common says nothing. Default 2000. */
	maxBucket?: number
	/** Candidates fetched per document by the live check. Default 200. */
	candidateLimit?: number
}

export type CollectionDedupeOptions = {
	/** Duplicate search. Without it the collection only gets the manual merge. */
	match?: MatchConfig
	/**
	 * Composition seam for the merge spec: receives the spec derived from the schema and
	 * returns the spec to use. Every returned path must exist in the derived spec.
	 */
	fields?: (derived: MergeFieldSpec[]) => MergeFieldSpec[]
	/**
	 * What happens to the absorbed document: `trash` where the collection has a trash,
	 * `delete` otherwise. `trash` on a collection without one fails at startup.
	 */
	absorbed?: 'delete' | 'trash'
	/**
	 * On a collection with drafts, merge the latest drafts and save the result as a draft.
	 * By default the published documents are merged and the result is published.
	 */
	draft?: boolean
	/**
	 * How candidates are looked for in this collection. Receives the plugin's adapter: return
	 * it, extend it by spreading, or return an adapter of your own, used whole. Needs `match`.
	 */
	adapter?: DedupeAdapterFactory
	/**
	 * Look for duplicates of a document on every save and queue the pairs found. The document
	 * is indexed on every save either way. Default `true` when `match` is set.
	 */
	checkOnSave?: boolean
}

export type DedupeAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

/** Receives one of the plugin's collections and returns the collection to register. */
export type CollectionOverride = (collection: CollectionConfig) => CollectionConfig

export type MultiTenancyOptions = {
	/**
	 * The name of the tenant relationship field on tenant-scoped documents. Matches
	 * `tenantField.name` in `@payloadcms/plugin-multi-tenant`.
	 * @default 'tenant'
	 */
	tenantFieldName?: string
	/**
	 * The tenant-scoped collections, in the shape `@payloadcms/plugin-multi-tenant` takes them,
	 * so one object can be passed to both plugins. When set, only these collections are
	 * scoped; without it, every collection with the tenant field is. A collection with
	 * `isGlobal: true` holds one document per tenant and cannot be deduplicated.
	 *
	 * @example
	 * const collections = { customers: {}, settings: { isGlobal: true } }
	 * multiTenantPlugin({ collections })
	 * dedupe({ multiTenancy: { collections } })
	 */
	collections?: Partial<Record<CollectionSlug, { isGlobal?: boolean }>>
}

export type DedupePluginOptions = {
	/**
	 * Turns the plugin off for an environment: no hooks, endpoints, jobs or views. The
	 * plugin's own collections stay in the schema, so the next migration does not drop
	 * their tables.
	 */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/dedupe/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	/**
	 * Collections the plugin works on. `true` enables the manual merge with defaults; `false`
	 * leaves the collection out.
	 */
	collections?: Partial<Record<CollectionSlug, CollectionDedupeOptions | boolean>>
	/**
	 * Who may open the queue and the merge screen, and who may apply a merge. Both default
	 * to any logged-in user. Applying additionally requires the collection's own `read`
	 * access on every document of the group, `update` on the survivor, and `delete` on the
	 * absorbed ones (and `update`, when they go to the trash).
	 */
	access?: {
		review?: DedupeAccess
		merge?: DedupeAccess
	}
	/**
	 * Refuse to apply a merge when the database cannot open a transaction (MongoDB
	 * without a replica set). Off by default: the write order is safe without one.
	 */
	requireTransactions?: boolean
	/** The most documents one merge takes, the survivor included. Default 5, at least 2. */
	maxGroupSize?: number
	/**
	 * How candidates are looked for, in every collection without an `adapter` of its own.
	 * Receives the built-in keys adapter: return it, extend it by spreading, or return an
	 * adapter of your own. Default: the keys adapter.
	 */
	adapter?: DedupeAdapterFactory
	/**
	 * Runs the check on save and the admin's "Scan now" inside the request instead of on
	 * Payload's jobs queue, for a deployment without a job worker. The check then writes
	 * its pairs in the save's transaction, and a scan of a large collection holds the
	 * request open for minutes. Default `false`.
	 */
	disableJobsQueue?: boolean
	/** Jobs queue the check and scan tasks run on. Default `dedupe`. */
	queue?: string
	/**
	 * `cron` schedules the scan task through Payload's job scheduler; without it the task
	 * is only queued from the admin or by hand.
	 */
	scan?: { cron?: string }
	/**
	 * Admin views of the queue and the merge screen. `false` removes them; the path defaults
	 * to `/dedupe`. The plugin adds no link to them: place one where the admin needs it.
	 */
	view?: { path?: `/${string}` } | false
	/**
	 * Adjust the plugin's own collections (labels, admin, access, extra fields). Hooks
	 * are refused: the plugin writes these collections through the database layer.
	 * `keys` is the built-in adapter's collection, absent when the adapter in use does not
	 * spread `keys`.
	 */
	overrides?: {
		keys?: CollectionOverride
		pairs?: CollectionOverride
		merges?: CollectionOverride
	}
	/** Read access on the plugin's own collections through the REST and GraphQL APIs. Default: nobody. */
	collectionAccess?: { read?: Access }
	/**
	 * Scope the search by tenant: documents of different tenants never share a bucket,
	 * pairs carry their tenant and the queue filters by the tenant cookie. `true` takes
	 * the defaults of `@payloadcms/plugin-multi-tenant`.
	 */
	multiTenancy?: MultiTenancyOptions | true
	/** Receives an event for every pair found or decided, merge applied or failed, and scan finished. */
	events?: DedupeEventSink
}

export type ResolvedCollectionOptions = {
	slug: CollectionSlug
	match: Required<MatchConfig> | null
	adapter?: DedupeAdapterFactory
	fields?: CollectionDedupeOptions['fields']
	/** Unset: decided by whether the collection has a trash. */
	absorbed?: 'delete' | 'trash'
	draft: boolean
	checkOnSave: boolean
}

export type ResolvedOptions = {
	collections: ResolvedCollectionOptions[]
	access: { review: DedupeAccess; merge: DedupeAccess }
	requireTransactions: boolean
	maxGroupSize: number
	adapter: DedupeAdapterFactory | null
	disableJobsQueue: boolean
	queue: string
	scanCron: string | null
	view: { path: `/${string}` } | false
	overrides: NonNullable<DedupePluginOptions['overrides']>
	collectionAccess: { read: Access }
	tenantFieldName: string | null
	/** The tenant-scoped collections; null to scope every collection with the tenant field. */
	tenantCollections: string[] | null
	events: DedupeEventSink | null
	translations?: TranslationsOption
}

const loggedIn: DedupeAccess = ({ req }) => Boolean(req.user)

export const DEFAULT_MIN_SCORE = 0.35

const DEFAULT_MAX_GROUP_SIZE = 5
export const DEFAULT_MAX_BUCKET = 2000
const DEFAULT_CANDIDATE_LIMIT = 200

/** A score threshold: a number from 0 to 1. */
export const isScore = (value: unknown): value is number =>
	typeof value === 'number' && value >= 0 && value <= 1

const isPositiveNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value > 0

const isOnDiffer = (value: unknown): boolean =>
	value === undefined ||
	value === 'veto' ||
	(typeof value === 'number' && Number.isFinite(value) && value <= 0)

/** What the types cannot check: value ranges and a path listed twice. */
const validateMatchField = (field: MatchFieldConfig, index: number, seen: Set<string>): void => {
	if (!field.path) throw new Error(`dedupe: match field #${index + 1}: \`path\` is empty`)
	const fail = (message: string): never => {
		throw new Error(`dedupe: match field "${field.path}": ${message}`)
	}
	if (seen.has(field.path)) fail('the same path is listed twice')
	seen.add(field.path)
	if (!isPositiveNumber(field.weight)) fail('`weight` must be a positive number')
	if (!isOnDiffer(field.onDiffer)) fail("`onDiffer` must be a number of 0 or less, or 'veto'")
	const { tolerance, toleranceType } = field
	if ((tolerance !== undefined || toleranceType !== undefined) && field.compare !== 'number') {
		fail("`tolerance` and `toleranceType` apply to `compare: 'number'` only")
	}
	if (
		tolerance !== undefined &&
		!(
			typeof tolerance === 'number' &&
			Number.isFinite(tolerance) &&
			tolerance >= 0 &&
			tolerance <= 100
		)
	) {
		fail('`tolerance` must be a number from 0 to 100')
	}
}

const resolveMatch = (match: MatchConfig | undefined): Required<MatchConfig> | null => {
	if (!match) return null
	if (match.fields.length === 0) {
		throw new Error('dedupe: `match.fields` must name at least one field')
	}
	const seen = new Set<string>()
	for (const [index, field] of match.fields.entries()) validateMatchField(field, index, seen)
	if (match.fields.every((field) => field.key === false)) {
		throw new Error(
			'dedupe: at least one match field must keep `key` on, or no candidate is ever found'
		)
	}
	const { minScore, maxBucket, candidateLimit } = match
	if (minScore !== undefined && !isScore(minScore)) {
		throw new Error('dedupe: `match.minScore` must be a number from 0 to 1')
	}
	if (maxBucket !== undefined && !(Number.isInteger(maxBucket) && maxBucket >= 2)) {
		throw new Error('dedupe: `match.maxBucket` must be a whole number of 2 or more')
	}
	if (candidateLimit !== undefined && !(Number.isInteger(candidateLimit) && candidateLimit >= 1)) {
		throw new Error('dedupe: `match.candidateLimit` must be a whole number of 1 or more')
	}
	return {
		fields: match.fields,
		minScore: match.minScore ?? DEFAULT_MIN_SCORE,
		maxBucket: match.maxBucket ?? DEFAULT_MAX_BUCKET,
		candidateLimit: match.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
	}
}

const viewPath = (path: `/${string}` | undefined): `/${string}` => {
	if (path !== undefined && !path.startsWith('/')) {
		throw new Error('dedupe: `view.path` must start with a slash')
	}
	return path ?? '/dedupe'
}

/** Normalize `true` to `{}` and fill defaults. */
export const resolveOptions = (options: DedupePluginOptions): ResolvedOptions => {
	const collections: ResolvedCollectionOptions[] = []
	for (const [slug, value] of Object.entries(options.collections ?? {})) {
		if (value === undefined || value === false) continue
		const opts: CollectionDedupeOptions = value === true ? {} : value
		const match = resolveMatch(opts.match)
		if (opts.adapter && !match) {
			throw new Error(`dedupe: \`adapter\` on "${slug}" needs a \`match\` config to search with`)
		}
		collections.push({
			slug: slug as CollectionSlug,
			match,
			adapter: opts.adapter,
			fields: opts.fields,
			absorbed: opts.absorbed,
			draft: opts.draft ?? false,
			checkOnSave: opts.checkOnSave ?? match !== null,
		})
	}
	const multiTenancy = options.multiTenancy === true ? {} : options.multiTenancy
	for (const { slug } of collections) {
		if (multiTenancy?.collections?.[slug]?.isGlobal) {
			throw new Error(
				`dedupe: "${slug}" is \`isGlobal\` in \`multiTenancy.collections\`: one document per tenant has no duplicates`
			)
		}
	}
	const { maxGroupSize = DEFAULT_MAX_GROUP_SIZE } = options
	if (!Number.isInteger(maxGroupSize) || maxGroupSize < 2) {
		throw new Error('dedupe: `maxGroupSize` must be a whole number of at least 2')
	}
	return {
		collections,
		access: {
			review: options.access?.review ?? loggedIn,
			merge: options.access?.merge ?? loggedIn,
		},
		requireTransactions: options.requireTransactions ?? false,
		maxGroupSize,
		adapter: options.adapter ?? null,
		disableJobsQueue: options.disableJobsQueue ?? false,
		queue: options.queue ?? 'dedupe',
		scanCron: options.scan?.cron ?? null,
		view: options.view === false ? false : { path: viewPath(options.view?.path) },
		overrides: options.overrides ?? {},
		collectionAccess: { read: options.collectionAccess?.read ?? (() => false) },
		tenantFieldName: multiTenancy ? (multiTenancy.tenantFieldName ?? 'tenant') : null,
		tenantCollections: multiTenancy?.collections ? Object.keys(multiTenancy.collections) : null,
		events: options.events ?? null,
		translations: options.translations,
	}
}
