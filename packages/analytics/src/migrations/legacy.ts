import { DatabaseKVAdapter, type Payload } from 'payload'
import { isCollectionSlug } from '../core/collectionSlug'
import { hasMethods, isRecord } from '../core/values'
import { dbKind } from '../db/kind'
import { DETACHED } from '../db/openTransaction'
import { chunksOf } from '../native/store/chunks'

/**
 * Every MongoDB collection the native engine of 1.0.0-beta.11 and earlier stored data in, under
 * both the pluralized name Payload's Mongo adapter defaults to and the slug as written.
 */
export const LEGACY_MONGO_COLLECTIONS: readonly string[] = [
	'analytics-events',
	'analytics-rollups',
	'analytics-seen',
	'analytics-seens',
]

/** Where 1.0.0-beta.11 kept each day's visitor salt in Payload's key-value store. */
export const LEGACY_SALT_PREFIX = 'analytics:salt:'

/**
 * How 1.0.0-beta.11 and earlier keyed the reads they cached in Payload's key-value store: a read
 * as `analytics|...`, a live count as `rt:[e<epoch>:]<source>:<metric>:<minutes>:<bucket>[:...]`.
 */
const LEGACY_CACHE_KEYS: readonly RegExp[] = [/^analytics\|/, /^rt:.+:[A-Za-z]+:\d+:\d+(?::.*)?$/]

/** The task 1.0.0-beta.11 scheduled for retention, whose next run its schedule kept queued. */
export const LEGACY_PRUNE_TASK = 'analytics-prune-events'

/** The name 1.0.0-beta.11 gave the warm task, now `analytics-warm`. */
export const LEGACY_WARM_TASK = 'analytics-warm-cache'

const LEGACY_TASKS: readonly string[] = [LEGACY_PRUNE_TASK, LEGACY_WARM_TASK]

export interface LegacyDropReport {
	/** The collections this run found and dropped. */
	collections: string[]
	/** The old salts this run deleted. */
	salts: number
	/** The old cached reads this run deleted. */
	cached: number
	/** The queued runs of the old retention and warm tasks this run deleted. */
	jobs: number
}

const NOT_MONGO =
	'analytics: dropLegacyNative is for MongoDB. On Postgres and SQLite, `payload migrate:create` generates the migration that drops the old tables (analytics_events, analytics_rollups, analytics_seen) and creates the new ones.'

/** MongoDB's code for a collection that no longer exists. */
const NAMESPACE_NOT_FOUND = 26

/** Payload's jobs collection, whose slug MongoDB keeps as written. */
const JOBS_COLLECTION = 'payload-jobs'

/** The slice of the MongoDB driver's `Db` the drop calls. */
interface MongoDb {
	listCollections(filter: object, options: object): { toArray(): PromiseLike<unknown[]> }
	dropCollection(name: string): PromiseLike<unknown>
	collection(name: string): { deleteMany(filter: object): PromiseLike<unknown> }
}

const isMongoDb = (value: unknown): value is MongoDb =>
	hasMethods(value, ['listCollections', 'dropCollection', 'collection'])

/** The driver database behind Payload's Mongo adapter: `payload.db.connection.db`. */
const mongoDbOf = (payload: Payload): MongoDb => {
	const connection: unknown = Reflect.get(payload.db, 'connection')
	const db: unknown = isRecord(connection) ? connection.db : undefined
	if (!isMongoDb(db)) {
		throw new Error(
			'analytics: the MongoDB adapter is not connected, so no collection can be dropped'
		)
	}
	return db
}

/** Drops one collection, answering false when another run dropped it first. */
const dropOne = async (db: MongoDb, name: string): Promise<boolean> => {
	try {
		await db.dropCollection(name)
		return true
	} catch (err) {
		if (isRecord(err) && err.code === NAMESPACE_NOT_FOUND) {
			return false
		}
		throw err
	}
}

/** Keys one bulk delete of the key-value collection names at most. */
const KV_DELETE_CHUNK = 500

/**
 * Deletes the keys of Payload's key-value store that `stale` matches and answers how many: one
 * statement per share of them where it is the default store on the database's own collection,
 * else one key at a time through its adapter.
 */
const deleteKeysWhere = async (
	payload: Payload,
	stale: (key: string) => boolean
): Promise<number> => {
	const { kv } = payload
	const keys = (await kv.keys()).filter(stale)
	const slug = kv instanceof DatabaseKVAdapter ? kv.collectionSlug : undefined
	if (slug !== undefined && isCollectionSlug(payload, slug)) {
		for (const chunk of chunksOf(keys, KV_DELETE_CHUNK)) {
			await payload.db.deleteMany({
				collection: slug,
				where: { key: { in: [...chunk] } },
				req: DETACHED,
			})
		}
	} else {
		for (const key of keys) {
			await kv.delete(key)
		}
	}
	return keys.length
}

/**
 * Deletes the salts 1.0.0-beta.11 left in Payload's key-value store, which hash no visitor now,
 * and answers how many. Any database: on Postgres and SQLite, call it from the migration's `up`.
 */
export const deleteLegacySalts = ({ payload }: { payload: Payload }): Promise<number> =>
	deleteKeysWhere(payload, (key) => key.startsWith(LEGACY_SALT_PREFIX))

/**
 * Deletes the reads 1.0.0-beta.11 and earlier cached in Payload's key-value store, which nothing
 * would ever delete now, and answers how many. Any database, any install, native or not.
 */
export const deleteLegacyCache = ({ payload }: { payload: Payload }): Promise<number> =>
	deleteKeysWhere(payload, (key) => LEGACY_CACHE_KEYS.some((pattern) => pattern.test(key)))

/** Deletes queued runs of a task this version no longer registers, which no runner could run. */
const deleteLegacyJobs = async (db: MongoDb): Promise<number> => {
	const result = await db
		.collection(JOBS_COLLECTION)
		.deleteMany({ taskSlug: { $in: [...LEGACY_TASKS] } })
	const deleted = isRecord(result) ? result.deletedCount : undefined
	return typeof deleted === 'number' ? deleted : 0
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * Drops what the native engine stored on MongoDB up to 1.0.0-beta.11; rerunning changes nothing.
 * Works outside the migration's transaction, which cannot drop a collection, so nothing rolls back.
 */
export const dropLegacyNative = async ({
	payload,
}: {
	payload: Payload
}): Promise<LegacyDropReport> => {
	if (dbKind(payload) !== 'mongo') {
		throw new Error(NOT_MONGO)
	}
	const db = mongoDbOf(payload)
	const listed = await db
		.listCollections({ name: { $in: [...LEGACY_MONGO_COLLECTIONS] } }, { nameOnly: true })
		.toArray()
	const found = listed
		.flatMap((entry) => (isRecord(entry) && typeof entry.name === 'string' ? [entry.name] : []))
		.sort()
	const collections: string[] = []
	for (const name of found) {
		if (await dropOne(db, name)) {
			collections.push(name)
		}
	}
	const salts = await deleteLegacySalts({ payload })
	const cached = await deleteLegacyCache({ payload })
	const jobs = await deleteLegacyJobs(db)
	payload.logger.info(
		`analytics: dropped ${collections.length > 0 ? collections.join(', ') : 'no legacy collection'}, ${plural(salts, 'legacy salt')}, ${plural(cached, 'legacy cached read')} and ${plural(jobs, 'queued legacy job')}`
	)
	return { collections, salts, cached, jobs }
}
