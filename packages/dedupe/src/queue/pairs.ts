import { getTranslation } from '@payloadcms/translations'
import type { CollectionSlug, PayloadRequest, Where } from 'payload'
import { toWords } from 'payload/shared'

import { PAIRS_SLUG, type PairStatus } from '../collections/slugs'
import { pairKeyFor, sortedPair } from '../match/keys'
import type { MatchResult, MatchSignal } from '../match/score'
import type { LoadedDoc } from '../merge/load'
import { type CollectionContext, type PluginContext, tenantOf, userRef } from '../plugin/context'
import { emitEvent } from '../plugin/events'
import { regroup } from './groups'

export type PairRow = {
	id: number | string
	target: string
	pairKey: string
	docA: string
	docB: string
	tenant: string | null
	score: number
	signals: MatchSignal[] | null
	status: PairStatus
	/** The strongest pair of its group, the one the queue pages by. Unset until regrouped. */
	lead?: boolean | null
	lastSeenAt: string | null
	decidedAt: string | null
	decidedBy: string | null
	createdAt: string
	updatedAt: string
}

/** A signal as the admin shows it: the field under its label in the reader's language. */
export type SignalView = MatchSignal & { label: string }

export const labelSignals = (
	req: PayloadRequest,
	col: CollectionContext,
	signals: MatchSignal[] | null
): SignalView[] =>
	(signals ?? []).map((signal) => {
		const label = col.specByPath.get(signal.path)?.label
		return {
			...signal,
			label:
				label === false || label === undefined
					? toWords(signal.path.split('.').pop() ?? signal.path)
					: getTranslation(label, req.i18n),
		}
	})

export const findPairByKey = async (
	req: PayloadRequest,
	pairKey: string
): Promise<PairRow | null> => {
	const result = await req.payload.db.find({
		collection: PAIRS_SLUG,
		where: { pairKey: { equals: pairKey } },
		limit: 1,
		pagination: false,
		req,
	})
	return (result.docs[0] as PairRow | undefined) ?? null
}

/**
 * Record what the scorer found for two documents.
 *
 * The reviewer's decision outlives the run that produced the row: a dismissed pair only gets
 * its score refreshed, never its status. An open pair that dropped below the threshold is
 * deleted.
 */
export const upsertPair = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	a: number | string
	b: number | string
	result: MatchResult
	seenAt: string
	tenant: string | null
	/** The stored row, when the caller has read it already; `null` for none. */
	known?: PairRow | null
}): Promise<PairRow | null> => {
	const { req, ctx, col, a, b, result, seenAt, tenant, known } = args
	const { db } = req.payload
	const pairKey = pairKeyFor(col.slug, a, b)
	const [docA, docB] = sortedPair(a, b)
	const existing = known === undefined ? await findPairByKey(req, pairKey) : known
	const minScore = col.options.match?.minScore ?? 1
	const qualifies = result.score >= minScore

	if (!existing) {
		if (!qualifies) return null
		let created: unknown
		try {
			created = await db.create({
				collection: PAIRS_SLUG,
				data: {
					target: col.slug,
					pairKey,
					docA,
					docB,
					tenant,
					score: result.score,
					signals: result.signals,
					status: 'open',
					lastSeenAt: seenAt,
				},
				req,
			})
		} catch (error) {
			// Another check stored this pair in the meantime. Inside a transaction the failed
			// write has ended it, so the row is read back only outside one.
			const stored = req.transactionID ? null : await findPairByKey(req, pairKey)
			if (!stored) throw error
			return upsertPair({ ...args, known: stored })
		}
		const row = created as PairRow
		await emitEvent(
			ctx.options.events,
			{
				type: 'pair.found',
				collection: col.slug,
				pairId: String(row.id),
				docA,
				docB,
				score: result.score,
			},
			req
		)
		return row
	}

	if (existing.status === 'open' && !qualifies) {
		await db.deleteOne({ collection: PAIRS_SLUG, where: { id: { equals: existing.id } }, req })
		return null
	}
	return (await db.updateOne({
		collection: PAIRS_SLUG,
		id: existing.id,
		data: { tenant, score: result.score, signals: result.signals, lastSeenAt: seenAt },
		req,
	})) as unknown as PairRow
}

/**
 * Marks one pair not duplicates, or reopens it, and settles the groups it leaves and joins.
 * `regroup: false` leaves that to a caller deciding several pairs at once.
 */
export const decidePair = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	pair: PairRow
	status: 'dismissed' | 'open'
	regroup?: boolean
}): Promise<PairRow> => {
	const { req, ctx, pair, status } = args
	const updated = await req.payload.db.updateOne({
		collection: PAIRS_SLUG,
		id: pair.id,
		data:
			status === 'dismissed'
				? { status, decidedAt: new Date().toISOString(), decidedBy: userRef(req) }
				: { status, decidedAt: null, decidedBy: null },
		req,
	})
	await emitEvent(
		ctx.options.events,
		{
			type: status === 'dismissed' ? 'pair.dismissed' : 'pair.reopened',
			collection: pair.target,
			pairId: String(pair.id),
			docA: pair.docA,
			docB: pair.docB,
		},
		req
	)
	if (args.regroup !== false) {
		await regroup({ req, target: pair.target, docIds: [pair.docA, pair.docB] })
	}
	return updated as unknown as PairRow
}

/**
 * Marks every pair of a group not duplicates, or reopens them. A pair the scorer never found,
 * such as two documents merged by hand from the list, is created already decided, so a later
 * scan keeps it out of the queue.
 */
export const decideGroup = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	docs: LoadedDoc[]
	status: 'dismissed' | 'open'
}): Promise<void> => {
	const { req, ctx, col, docs, status } = args
	const from: PairStatus = status === 'dismissed' ? 'open' : 'dismissed'
	for (const [index, a] of docs.entries()) {
		for (const b of docs.slice(index + 1)) {
			const pairKey = pairKeyFor(col.slug, a.id, b.id)
			let pair = await findPairByKey(req, pairKey)
			if (!pair && status === 'open') continue
			if (!pair) {
				const [docA, docB] = sortedPair(a.id, b.id)
				pair = (await req.payload.db.create({
					collection: PAIRS_SLUG,
					data: {
						target: col.slug,
						pairKey,
						docA,
						docB,
						tenant: tenantOf(req.payload, col.slug, a),
						score: 0,
					},
					req,
				})) as PairRow
			}
			if (pair.status === from) await decidePair({ req, ctx, pair, status, regroup: false })
		}
	}
	await regroup({ req, target: col.slug, docIds: docs.map((doc) => doc.id) })
}

/**
 * Deletes every pair naming one of `docIds`: a document merged into another, deleted or moved
 * to the trash. `keepDismissed` leaves "Not duplicates" in place, for a document in the trash
 * that may come back. The groups the pairs held are settled again without them.
 */
export const closePairsFor = async (args: {
	req: PayloadRequest
	col: CollectionContext
	docIds: (number | string)[]
	keepDismissed?: boolean
}): Promise<void> => {
	const { req, col, keepDismissed = false } = args
	const ids = args.docIds.map(String)
	const named: Where = { or: [{ docA: { in: ids } }, { docB: { in: ids } }] }
	const { docs: closing } = await req.payload.db.find<Pick<PairRow, 'docA' | 'docB'>>({
		collection: PAIRS_SLUG,
		where: { and: [{ target: { equals: col.slug } }, named] },
		select: { docA: true, docB: true },
		limit: 0,
		pagination: false,
		req,
	})
	await req.payload.db.deleteMany({
		collection: PAIRS_SLUG,
		where: {
			and: [
				{ target: { equals: col.slug } },
				named,
				...(keepDismissed ? [{ status: { equals: 'open' } }] : []),
			],
		},
		req,
	})
	await regroup({
		req,
		target: col.slug,
		docIds: [...ids, ...closing.flatMap((pair) => [pair.docA, pair.docB])],
	})
}

/**
 * How many documents open pairs link to `ids`, directly or in a chain, beyond `ids` themselves:
 * the rest of the queue group a merge of `ids` leaves out. Only those the reader may read count.
 */
export const countLeftOut = async (args: {
	req: PayloadRequest
	col: CollectionContext
	ids: (number | string)[]
}): Promise<number> => {
	const { req, col } = args
	const shown = new Set(args.ids.map(String))
	const reached = new Set(shown)
	let frontier = [...shown]
	while (frontier.length > 0) {
		const { docs } = await req.payload.db.find<Pick<PairRow, 'docA' | 'docB'>>({
			collection: PAIRS_SLUG,
			where: {
				and: [
					{ target: { equals: col.slug } },
					{ status: { equals: 'open' } },
					{ or: [{ docA: { in: frontier } }, { docB: { in: frontier } }] },
				],
			},
			select: { docA: true, docB: true },
			limit: 0,
			pagination: false,
			req,
		})
		frontier = [...new Set(docs.flatMap((pair) => [pair.docA, pair.docB]))].filter(
			(id) => !reached.has(id)
		)
		for (const id of frontier) reached.add(id)
	}
	const rest = [...reached].filter((id) => !shown.has(id))
	if (rest.length === 0) return 0
	const { totalDocs } = await req.payload.count({
		collection: col.slug as CollectionSlug,
		where: { id: { in: rest } },
		overrideAccess: false,
		req,
	})
	return totalDocs
}
