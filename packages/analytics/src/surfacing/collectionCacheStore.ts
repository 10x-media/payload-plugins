import type { CollectionSlug, Payload } from 'payload'
import { currentDate } from '../core/clock'
import { isCollectionSlug } from '../core/collectionSlug'
import { canonicalJson, hasMethods, isRecord } from '../core/values'
import { detachedWrite } from '../db/detachedWrite'
import { isUniqueViolation } from '../db/errors'
import { knownDbKind } from '../db/kind'
import { DETACHED } from '../db/openTransaction'
import { dateOf } from '../native/store/columnValues'
import {
	type CacheEntry,
	type CacheStore,
	isCachedResult,
	isReadRecipe,
	type ReadRecipe,
} from './cacheStore'

/** Rows `recentRecipes` reads per recipe it answers with, as several entries share one recipe. */
const ROWS_PER_RECIPE = 4

/** The most rows `recentRecipes` reads in one call. */
const MAX_RECIPE_ROWS = 2_000

/** The name MongoDB gives an index on `staleUntil` alone. */
export const TTL_INDEX_NAME = 'staleUntil_1'

interface CacheRow {
	id: number | string
	value?: unknown
	fetchedAt?: unknown
	expiresAt?: unknown
	staleUntil?: unknown
	readAt?: unknown
	recipe?: unknown
}

const msOf = (value: unknown): number | null => dateOf(value)?.getTime() ?? null

const entryOf = (row: CacheRow | null): CacheEntry | null => {
	if (!row || !isCachedResult(row.value)) {
		return null
	}
	const fetchedAt = msOf(row.fetchedAt)
	const expiresAt = msOf(row.expiresAt)
	const staleUntil = msOf(row.staleUntil)
	if (fetchedAt === null || expiresAt === null || staleUntil === null) {
		return null
	}
	return { value: row.value, fetchedAt, expiresAt, staleUntil, readAt: msOf(row.readAt) }
}

/** The slice of a MongoDB driver collection the TTL index is created through. */
interface IndexedCollection {
	createIndex(keys: Record<string, 1>, options: object): PromiseLike<unknown>
}

const isIndexedCollection = (value: unknown): value is IndexedCollection =>
	hasMethods(value, ['createIndex'])

/** The driver collection behind Payload's mongoose model for `slug`. */
const mongoCollectionOf = (payload: Payload, slug: string): IndexedCollection | undefined => {
	const models: unknown = Reflect.get(payload.db, 'collections')
	const model: unknown = isRecord(models) ? models[slug] : undefined
	const collection: unknown =
		isRecord(model) || typeof model === 'function' ? Reflect.get(model, 'collection') : undefined
	return isIndexedCollection(collection) ? collection : undefined
}

export interface CollectionCacheStore extends CacheStore {
	/**
	 * On MongoDB, creates the TTL index that deletes an entry once its `staleUntil` passes, which
	 * Payload cannot declare; elsewhere does nothing. Never rejects: a failure is logged once.
	 */
	prepare(): Promise<void>
}

/**
 * The built-in store on `analytics-cache`, through `payload.db` outside any transaction. Two
 * instances storing one key at once both succeed, the second retried once as an update.
 */
export const collectionCacheStore = (
	payload: Payload,
	options: { slug: string; now?: () => Date }
): CollectionCacheStore => {
	const slug = options.slug
	const now = options.now ?? currentDate
	let prepared: Promise<void> | undefined

	const target = (): CollectionSlug => {
		if (!isCollectionSlug(payload, slug)) {
			throw new Error(`analytics: no "${slug}" collection is registered for the read cache`)
		}
		return slug
	}

	const createTtlIndex = async (): Promise<void> => {
		// Every other database, D1 and unknown adapters included, relies on the sweep alone.
		if (knownDbKind(payload) !== 'mongo') {
			return
		}
		try {
			const driver = mongoCollectionOf(payload, slug)
			if (!driver) {
				throw new Error(`the database has no model for the "${slug}" collection`)
			}
			await driver.createIndex({ staleUntil: 1 }, { expireAfterSeconds: 0, name: TTL_INDEX_NAME })
		} catch (err) {
			payload.logger?.warn(
				`analytics: the TTL index on "${slug}.staleUntil" could not be created, so expired cache entries wait for the plugin's periodic sweep instead: ${String(err)}`
			)
		}
	}

	const prepare = (): Promise<void> => {
		prepared ??= createTtlIndex()
		return prepared
	}

	const upsert = (data: Record<string, unknown>, key: string): Promise<unknown> =>
		payload.db.upsert({
			collection: target(),
			data,
			req: DETACHED,
			returning: false,
			select: {},
			where: { key: { equals: key } },
		})

	return {
		prepare,
		async get(key) {
			const row = await payload.db.findOne<CacheRow>({
				collection: target(),
				req: DETACHED,
				select: {
					value: true,
					fetchedAt: true,
					expiresAt: true,
					staleUntil: true,
					readAt: true,
				},
				where: { key: { equals: key } },
			})
			const entry = entryOf(row)
			return entry && entry.staleUntil > now().getTime() ? entry : null
		},
		async set(key, value, opts) {
			await prepare()
			const at = now().getTime()
			const expiresAt = at + opts.ttlSeconds * 1000
			const data: Record<string, unknown> = {
				key,
				value,
				owner: opts.scope ?? '',
				fetchedAt: new Date(at),
				expiresAt: new Date(expiresAt),
				staleUntil: new Date(expiresAt + opts.staleSeconds * 1000),
				...(opts.recipe ? { recipe: opts.recipe, readAt: new Date(at) } : {}),
			}
			await detachedWrite(
				payload,
				async () => {
					try {
						await upsert(data, key)
					} catch (err) {
						if (!isUniqueViolation(err, payload)) {
							throw err
						}
						await upsert(data, key)
					}
				},
				undefined
			)
		},
		async touch(key, at, recipe) {
			await detachedWrite(
				payload,
				() =>
					payload.db.updateMany({
						collection: target(),
						data: { readAt: at, ...(recipe ? { recipe } : {}) },
						req: DETACHED,
						returning: false,
						where: { key: { equals: key } },
					}),
				null
			)
		},
		async sweep(at, batch) {
			const expired = { staleUntil: { less_than: at.toISOString() } }
			const found = await payload.db.find<CacheRow>({
				collection: target(),
				limit: batch,
				pagination: false,
				req: DETACHED,
				select: { staleUntil: true },
				where: expired,
			})
			const ids = found.docs.map((row) => row.id)
			if (ids.length === 0) {
				return 0
			}
			// Still expired at delete time: an entry written again in between is kept. A sweep that
			// would wait on a lock this process holds deletes nothing now and is tried again later.
			return detachedWrite(
				payload,
				async () => {
					await payload.db.deleteMany({
						collection: target(),
						req: DETACHED,
						where: { and: [{ id: { in: ids } }, expired] },
					})
					return ids.length
				},
				0
			)
		},
		async recentRecipes(since, limit) {
			if (limit <= 0) {
				return []
			}
			const found = await payload.db.find<CacheRow>({
				collection: target(),
				limit: Math.min(limit * ROWS_PER_RECIPE, MAX_RECIPE_ROWS),
				pagination: false,
				req: DETACHED,
				select: { recipe: true, readAt: true },
				sort: '-readAt',
				where: { readAt: { greater_than_equal: since.toISOString() } },
			})
			const seen = new Set<string>()
			const recipes: ReadRecipe[] = []
			for (const row of found.docs) {
				const recipe = row.recipe
				if (!isReadRecipe(recipe)) {
					continue
				}
				const id = canonicalJson(recipe)
				if (seen.has(id)) {
					continue
				}
				seen.add(id)
				recipes.push(recipe)
				if (recipes.length >= limit) {
					break
				}
			}
			return recipes
		},
	}
}
