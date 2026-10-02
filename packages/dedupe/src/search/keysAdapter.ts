import type { Access, PayloadRequest, Where } from 'payload'

import { buildKeysCollection } from '../collections/build'
import { KEYS_SLUG } from '../collections/slugs'
import { blockingKeys } from '../match/keys'
import type { CollectionOverride } from '../options'
import { getCollectionContext, getContext, tenantOf } from '../plugin/context'
import { addCollection } from '../plugin/registerCollections'
import type { AdapterDoc, DedupeAdapter, KeyBucket, ScanPage } from './contract'

type KeyRow = { doc: string; key: string }

/** The document's blocking keys, and the hash of the match config they come from. */
const keysOf = (req: PayloadRequest, collection: string, doc: AdapterDoc) => {
	const col = getCollectionContext(req.payload, collection)
	return {
		keys: blockingKeys(doc, col.matchFields, tenantOf(getContext(req.payload), doc)),
		configHash: col.configHash,
	}
}

/**
 * Rows sorted by key, grouped into buckets. `rows` is one page read with `limit + 1`: when
 * it overflowed, a single key filling it is a bucket too large to compare, and otherwise
 * the last group may continue on the next page and is left for it.
 */
export const bucketPage = (rows: KeyRow[], limit: number): ScanPage => {
	const grouped: KeyBucket[] = []
	for (const row of rows) {
		const last = grouped[grouped.length - 1]
		if (last && last.key === row.key) {
			last.ids.push(String(row.doc))
		} else {
			grouped.push({ key: row.key, ids: [String(row.doc)] })
		}
	}
	if (rows.length <= limit) {
		return { buckets: grouped, nextCursor: null, oversized: [] }
	}
	if (grouped.length === 1) {
		const only = grouped[0] as KeyBucket
		return { buckets: [], nextCursor: only.key, oversized: [only.key] }
	}
	const complete = grouped.slice(0, -1)
	const lastComplete = complete[complete.length - 1] as KeyBucket
	return { buckets: complete, nextCursor: lastComplete.key, oversized: [] }
}

/**
 * The built-in candidate source: one row per document and blocking key in a collection
 * of its own, so "who shares a key with this document" is an indexed query per key on both
 * databases, and the full scan is one sorted walk over the same rows.
 *
 * Each key is one `create`: the database layer has no bulk insert, so indexing a large
 * collection is a matter of minutes.
 */
export const keysAdapter = (args: {
	read: Access
	override: CollectionOverride | undefined
}): DedupeAdapter => ({
	register: (config) => addCollection(config, buildKeysCollection(args.read), args.override),

	// Only what changed: a save that leaves the match fields alone writes nothing, and a
	// key stored twice by two saves racing each other is dropped.
	index: async ({ req, collection, doc }) => {
		const { db } = req.payload
		const docId = String(doc.id)
		const { keys, configHash } = keysOf(req, collection, doc)
		const stored = (
			await db.find<KeyRow & { id: number | string; configHash: string }>({
				collection: KEYS_SLUG,
				where: { and: [{ target: { equals: collection } }, { doc: { equals: docId } }] },
				pagination: false,
				req,
			})
		).docs
		const wanted = new Set(keys)
		const kept = new Set<string>()
		const stale = stored.filter((row) => {
			if (row.configHash !== configHash || !wanted.has(row.key) || kept.has(row.key)) return true
			kept.add(row.key)
			return false
		})
		if (stale.length > 0) {
			await db.deleteMany({
				collection: KEYS_SLUG,
				where: { id: { in: stale.map((row) => row.id) } },
				req,
			})
		}
		for (const key of keys) {
			if (kept.has(key)) continue
			await db.create({
				collection: KEYS_SLUG,
				data: { target: collection, doc: docId, key, configHash },
				req,
				returning: false,
			})
		}
	},

	remove: async ({ req, collection, id }) => {
		await req.payload.db.deleteMany({
			collection: KEYS_SLUG,
			where: { and: [{ target: { equals: collection } }, { doc: { equals: id } }] },
			req,
		})
	},

	// One query per key rather than one for all of them: a key half the collection shares
	// would otherwise fill the limit and hide the one document that shares a rare key. A key
	// with more documents than the limit is too common to tell anything and is skipped, as
	// the scan skips a bucket over `maxBucket`.
	findCandidates: async ({ req, collection, doc, limit }) => {
		const { keys, configHash } = keysOf(req, collection, doc)
		const ids = new Set<string>()
		for (const key of keys) {
			const conditions: Where[] = [
				{ target: { equals: collection } },
				{ configHash: { equals: configHash } },
				{ key: { equals: key } },
			]
			if (doc.id !== undefined) conditions.push({ doc: { not_equals: String(doc.id) } })
			const result = await req.payload.db.find<KeyRow>({
				collection: KEYS_SLUG,
				where: { and: conditions },
				limit: limit + 1,
				pagination: false,
				req,
			})
			const rows = result.docs
			if (rows.length > limit) continue
			for (const row of rows) ids.add(String(row.doc))
			if (ids.size >= limit) break
		}
		return [...ids].slice(0, limit).map((id) => ({ id }))
	},

	scanBuckets: async ({ req, collection, cursor, limit }) => {
		const conditions: Where[] = [
			{ target: { equals: collection } },
			{ configHash: { equals: getCollectionContext(req.payload, collection).configHash } },
		]
		if (cursor !== null) conditions.push({ key: { greater_than: cursor } })
		const result = await req.payload.db.find<KeyRow>({
			collection: KEYS_SLUG,
			where: { and: conditions },
			sort: 'key',
			limit: limit + 1,
			pagination: false,
			req,
		})
		return bucketPage(result.docs, limit)
	},
})
