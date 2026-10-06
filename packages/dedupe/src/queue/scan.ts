import { APIError, type PayloadRequest, type Where } from 'payload'

import { PAIRS_SLUG } from '../collections/slugs'
import { pairKeyFor } from '../match/keys'
import { scorePair } from '../match/score'
import { isLive, type LoadedDoc, loadDocs, localRequest } from '../merge/load'
import { type CollectionContext, type PluginContext, tenantOf } from '../plugin/context'
import { emitEvent } from '../plugin/events'
import type { KeyBucket, ScanPage } from '../search/contract'
import { checkDocument } from './live'
import { upsertPair } from './pairs'

export type ScanSummary = {
	collection: string
	indexed: number
	buckets: number
	skippedBuckets: number
	compared: number
	pairs: number
	stale: number
	startedAt: string
	finishedAt: string
}

const PAGE = 200
const KEY_ROWS_PER_PAGE = 5000
const CACHE_LIMIT = 5000

/**
 * Walks the collection in the state the plugin merges, by id: an import writes many
 * documents with the same `createdAt`, and pages sorted by it could skip or repeat them.
 */
const eachDocument = async (
	args: { req: PayloadRequest; ctx: PluginContext; col: CollectionContext },
	visit: (doc: LoadedDoc) => Promise<void>
): Promise<number> => {
	const { req, ctx, col } = args
	let last: number | string | null = null
	let count = 0
	for (;;) {
		const result = await req.payload.find({
			collection: col.slug,
			depth: 0,
			limit: PAGE,
			pagination: false,
			sort: 'id',
			...(last === null ? {} : { where: { id: { greater_than: last } } }),
			...(ctx.localeCodes ? { locale: 'all' } : {}),
			draft: col.hasDrafts && col.options.draft,
			overrideAccess: true,
			req: localRequest(req),
		})
		const docs = result.docs as LoadedDoc[]
		for (const doc of docs) {
			if (!isLive(col, doc)) continue
			await visit(doc)
			count++
		}
		if (docs.length < PAGE) break
		last = (docs[docs.length - 1] as LoadedDoc).id
	}
	return count
}

/**
 * A bounded document cache for the bucket pass. Buckets that share documents (the same
 * person under a name key and a birth date key) reuse them instead of refetching.
 */
const createCache = (args: { req: PayloadRequest; ctx: PluginContext; col: CollectionContext }) => {
	const cache = new Map<string, LoadedDoc>()
	return async (ids: string[]): Promise<LoadedDoc[]> => {
		const missing = ids.filter((id) => !cache.has(id))
		if (missing.length > 0) {
			if (cache.size + missing.length > CACHE_LIMIT) cache.clear()
			for (let i = 0; i < missing.length; i += 100) {
				for (const doc of await loadDocs({ ...args, ids: missing.slice(i, i + 100) })) {
					cache.set(String(doc.id), doc)
				}
			}
		}
		const out: LoadedDoc[] = []
		for (const id of ids) {
			const doc = cache.get(id)
			if (doc && isLive(args.col, doc)) out.push(doc)
		}
		return out
	}
}

/**
 * The whole-collection scan. Re-indexes every live document first, so an import that
 * bypassed the hooks and a changed match config are both healed by the run, then walks
 * the buckets and scores each pair once. Pairs the run did not see go stale.
 */
export const runScan = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
}): Promise<ScanSummary> => {
	const { ctx, col } = args
	const match = col.options.match
	if (!match) {
		throw new Error(`dedupe: collection "${col.slug}" has no match config to scan with`)
	}
	// Two runs at once would each rebuild the keys under the other's feet. The lock is
	// per instance; a second server can still start one, so a queue with one worker is
	// the safer way to run it.
	if (ctx.scanning.has(col.slug)) {
		throw new APIError(`A scan of "${col.slug}" is already running.`, 409, undefined, true)
	}
	ctx.scanning.add(col.slug)
	try {
		return await scan(args, match)
	} finally {
		ctx.scanning.delete(col.slug)
	}
}

const scan = async (
	args: { req: PayloadRequest; ctx: PluginContext; col: CollectionContext },
	match: NonNullable<CollectionContext['options']['match']>
): Promise<ScanSummary> => {
	const { req, ctx, col } = args
	const startedAt = new Date().toISOString()
	const summary: ScanSummary = {
		collection: col.slug,
		indexed: 0,
		buckets: 0,
		skippedBuckets: 0,
		compared: 0,
		pairs: 0,
		stale: 0,
		startedAt,
		finishedAt: startedAt,
	}

	const { adapter } = col
	if (adapter.index) {
		summary.indexed = await eachDocument(args, async (doc) => {
			await adapter.index?.({ req, collection: col.slug, doc })
		})
	}

	const seen = new Set<string>()
	const seenAt = new Date().toISOString()
	const load = createCache(args)

	const scoreBucket = async (bucket: KeyBucket): Promise<void> => {
		// A key stored twice, by two saves racing each other, must not pair a document with itself.
		const ids = [...new Set(bucket.ids)]
		if (ids.length < 2) return
		if (ids.length > match.maxBucket) {
			summary.skippedBuckets++
			return
		}
		summary.buckets++
		const docs = await load(ids)
		for (let i = 0; i < docs.length; i++) {
			for (let j = i + 1; j < docs.length; j++) {
				const a = docs[i] as LoadedDoc
				const b = docs[j] as LoadedDoc
				// The plugin keeps tenants apart whatever an adapter's buckets hold, as the check on save does.
				if (tenantOf(req.payload, col.slug, a) !== tenantOf(req.payload, col.slug, b)) continue
				const pairKey = pairKeyFor(col.slug, a.id, b.id)
				if (seen.has(pairKey)) continue
				seen.add(pairKey)
				summary.compared++
				const result = scorePair(a, b, col.matchFields)
				// Most pairs in a bucket are strangers; only a match is worth a look-up. A stored
				// pair that no longer matches goes stale at the end, as one not seen at all.
				if (result.score < match.minScore) continue
				const row = await upsertPair({
					req,
					ctx,
					col,
					a: a.id,
					b: b.id,
					result,
					seenAt,
					tenant: tenantOf(req.payload, col.slug, a),
				})
				if (row && row.status === 'open') summary.pairs++
			}
		}
	}

	if (adapter.scanBuckets) {
		let cursor: string | null = null
		for (;;) {
			const page: ScanPage = await adapter.scanBuckets({
				req,
				collection: col.slug,
				cursor,
				// A page holds a whole bucket up to `maxBucket`; a smaller one would call it oversized.
				limit: Math.max(KEY_ROWS_PER_PAGE, match.maxBucket + 1),
			})
			summary.skippedBuckets += page.oversized.length
			for (const bucket of page.buckets) await scoreBucket(bucket)
			if (page.nextCursor === null) break
			cursor = page.nextCursor
		}
	} else {
		// A pair may be met from both of its documents, or from one only.
		const compared = new Set<string>()
		const found = new Set<string>()
		await eachDocument(args, async (doc) => {
			const result = await checkDocument({ req, ctx, col, doc })
			for (const key of result.compared) compared.add(key)
			for (const key of result.open) found.add(key)
		})
		summary.compared += compared.size
		summary.pairs += found.size
	}

	const unseen: Where = {
		and: [
			{ target: { equals: col.slug } },
			{ status: { equals: 'open' } },
			{ or: [{ lastSeenAt: { less_than: seenAt } }, { lastSeenAt: { exists: false } }] },
		],
	}
	// Counted first: Mongo reads the updated rows back with the same filter, which none match any more.
	summary.stale = (
		await req.payload.db.count({ collection: PAIRS_SLUG, where: unseen, req })
	).totalDocs
	await req.payload.db.updateMany({
		collection: PAIRS_SLUG,
		where: unseen,
		data: { status: 'stale' },
		req,
		returning: false,
	})
	summary.finishedAt = new Date().toISOString()
	await emitEvent(ctx.options.events, { type: 'scan.finished', collection: col.slug, summary }, req)
	return summary
}
