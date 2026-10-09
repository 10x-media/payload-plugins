import { APIError, type PayloadRequest } from 'payload'

import { PAIRS_SLUG } from '../collections/slugs'
import { pairKeyFor } from '../match/keys'
import { type MatchResult, type MatchSignal, scorePair } from '../match/score'
import { isLive, type LoadedDoc, loadDocs } from '../merge/load'
import { isScore } from '../options'
import {
	type CollectionContext,
	getCollectionContext,
	getContext,
	type PluginContext,
	tenantOf,
} from '../plugin/context'
import type { AdapterDoc } from '../search/contract'
import { type PairRow, upsertPair } from './pairs'

/**
 * Who the adapter offers for this document, scored on the real field values. The document
 * itself is left out, and so are candidates the scan would not compare (trashed, or
 * unpublished when the published state is merged) and those of another tenant, whatever
 * the adapter answered; `overrideAccess: false` also leaves out what the request's user
 * may not read.
 */
const scoreCandidates = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	doc: AdapterDoc
	overrideAccess?: boolean
}): Promise<{ candidate: LoadedDoc; result: MatchResult }[]> => {
	const { req, ctx, col, doc, overrideAccess } = args
	const match = col.options.match
	if (!match) return []
	const self = doc.id === undefined ? null : String(doc.id)
	const hits = await col.adapter.findCandidates({
		req,
		collection: col.slug,
		doc,
		limit: match.candidateLimit,
	})
	const ids = [...new Set(hits.map((hit) => String(hit.id)))].filter((id) => id !== self)
	const candidates = await loadDocs({
		req,
		ctx,
		col,
		ids: ids.slice(0, match.candidateLimit),
		...(overrideAccess === undefined ? {} : { overrideAccess }),
	})
	const tenant = tenantOf(req.payload, col.slug, doc)
	return candidates
		.filter(
			(candidate) => isLive(col, candidate) && tenantOf(req.payload, col.slug, candidate) === tenant
		)
		.map((candidate) => ({ candidate, result: scorePair(doc, candidate, col.matchFields) }))
}

export type Duplicate = { doc: LoadedDoc; score: number; signals: MatchSignal[] }

/**
 * Saved documents that look like `doc`, best first, from `minScore` up, the collection's own
 * by default. The search a save runs, with nothing stored: no key is indexed and no pair
 * written. `doc` may hold unsaved values; with an `id`, that document is left out of the
 * answer. `overrideAccess: false` leaves out what `req.user` may not read. A `minScore` only
 * filters the candidates the adapter offers: a lower one finds no document the adapter missed.
 */
export const findDuplicates = async (args: {
	req: PayloadRequest
	collection: string
	doc: AdapterDoc
	overrideAccess?: boolean
	minScore?: number
}): Promise<Duplicate[]> => {
	const { req, collection, doc, overrideAccess } = args
	const col = getCollectionContext(req.payload, collection)
	const match = col.options.match
	if (!match) {
		throw new APIError(`Collection "${collection}" has no match config`, 400, undefined, true)
	}
	if (args.minScore !== undefined && !isScore(args.minScore)) {
		throw new APIError('minScore must be a number from 0 to 1', 400, undefined, true)
	}
	const minScore = args.minScore ?? match.minScore
	const scored = await scoreCandidates({
		req,
		ctx: getContext(req.payload),
		col,
		doc,
		...(overrideAccess === undefined ? {} : { overrideAccess }),
	})
	return scored
		.filter(({ result }) => result.score >= minScore)
		.sort((a, b) => b.result.score - a.result.score)
		.map(({ candidate, result }) => ({
			doc: candidate,
			score: result.score,
			signals: result.signals,
		}))
}

/**
 * The check behind a save: ask the adapter for candidates, score the real field values,
 * and record what qualifies.
 */
export const checkDocument = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	doc: LoadedDoc
}): Promise<{ compared: string[]; open: string[] }> => {
	const { req, ctx, col, doc } = args
	const seenAt = new Date().toISOString()
	const open: string[] = []
	const scored = await scoreCandidates(args)
	const keys = scored.map(({ candidate }) => pairKeyFor(col.slug, doc.id, candidate.id))
	// Every stored pair of this document in one read, rather than one per look-alike.
	const id = String(doc.id)
	const stored = (
		await req.payload.db.find<PairRow>({
			collection: PAIRS_SLUG,
			where: {
				and: [
					{ target: { equals: col.slug } },
					{ or: [{ docA: { equals: id } }, { docB: { equals: id } }] },
				],
			},
			limit: 0,
			pagination: false,
			req,
		})
	).docs
	const known = new Map(stored.map((row) => [row.pairKey, row]))
	for (const { candidate, result } of scored) {
		const row = await upsertPair({
			req,
			ctx,
			col,
			a: doc.id,
			b: candidate.id,
			result,
			seenAt,
			tenant: tenantOf(req.payload, col.slug, doc),
			known: known.get(pairKeyFor(col.slug, doc.id, candidate.id)) ?? null,
		})
		// A pair the reviewer already decided keeps its status; only the open ones count as found.
		if (row?.status === 'open') open.push(row.pairKey)
	}

	// An open pair the adapter no longer offers: an edit may have taken the likeness away, or
	// moved the document to another tenant. Its other document is scored again, so the queue
	// does not wait for a scan to drop it.
	const otherOf = (row: PairRow) => (row.docA === id ? row.docB : row.docA)
	const offered = new Set(scored.map(({ candidate }) => String(candidate.id)))
	const left = stored.filter((row) => row.status === 'open' && !offered.has(otherOf(row)))
	const others = await loadDocs({ req, ctx, col, ids: left.map(otherOf) })
	for (const row of left) {
		const other = others.find((entry) => String(entry.id) === otherOf(row))
		if (!other || !isLive(col, other)) continue
		const result = scorePair(doc, other, col.matchFields)
		const apart = tenantOf(req.payload, col.slug, other) !== tenantOf(req.payload, col.slug, doc)
		const kept = await upsertPair({
			req,
			ctx,
			col,
			a: doc.id,
			b: other.id,
			result: apart ? { ...result, score: 0 } : result,
			seenAt,
			tenant: tenantOf(req.payload, col.slug, doc),
			known: row,
		})
		keys.push(row.pairKey)
		if (kept?.status === 'open') open.push(kept.pairKey)
	}
	return { compared: keys, open }
}
