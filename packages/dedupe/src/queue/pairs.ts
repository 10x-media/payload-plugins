import { getTranslation } from '@payloadcms/translations'
import type { CollectionSlug, PayloadRequest, Where } from 'payload'
import { mergeListSearchAndWhere, toWords } from 'payload/shared'

import { PAIR_STATUSES, PAIRS_SLUG, type PairStatus, pageSize } from '../collections/slugs'
import { pairKeyFor, sortedPair } from '../match/keys'
import type { MatchResult, MatchSignal } from '../match/score'
import { describeUsers, docTitle, type LoadedDoc, loadDocs } from '../merge/load'
import {
	type CollectionContext,
	getCollectionContext,
	listCollections,
	type PluginContext,
	tenantOf,
	tenantScope,
	userRef,
} from '../plugin/context'
import { emitEvent } from '../plugin/events'

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

export const decidePair = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	pair: PairRow
	status: 'dismissed' | 'open'
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
			if (pair.status === from) await decidePair({ req, ctx, pair, status })
		}
	}
}

/**
 * Deletes every pair naming one of `docIds`: a document merged into another, deleted or moved
 * to the trash. `keepDismissed` leaves "Not duplicates" in place, for a document in the trash
 * that may come back.
 */
export const closePairsFor = async (args: {
	req: PayloadRequest
	col: CollectionContext
	docIds: (number | string)[]
	keepDismissed?: boolean
}): Promise<void> => {
	const { req, col, keepDismissed = false } = args
	const ids = args.docIds.map(String)
	await req.payload.db.deleteMany({
		collection: PAIRS_SLUG,
		where: {
			and: [
				{ target: { equals: col.slug } },
				{ or: [{ docA: { in: ids } }, { docB: { in: ids } }] },
				...(keepDismissed ? [{ status: { equals: 'open' } }] : []),
			],
		},
		req,
	})
}

export type QueueGroup = {
	/** The strongest pair's id. */
	id: string
	collection: string
	/** Every document of the group, the most alike first. */
	docs: { id: string; title: string }[]
	/** The strongest pair's score, and why its two documents match. */
	score: number
	signals: SignalView[]
	status: PairStatus
	/** When and by whom the group was last marked not duplicates. */
	decidedAt: string | null
	decidedBy: string | null
}

export type QueueResponse = {
	collections: { slug: string; label: string; hasMatch: boolean }[]
	docs: QueueGroup[]
	totalDocs: number
	page: number
	totalPages: number
	counts: Record<PairStatus, number>
}

type Link = Pick<PairRow, 'id' | 'target' | 'docA' | 'docB' | 'score' | 'status' | 'decidedAt'>

/**
 * Pairs of one status as groups: the documents linked by pairs in a chain (A like B, B like C).
 * The strongest group first, and in each group its pairs strongest first.
 */
const groupPairs = (links: Link[]): Link[][] => {
	const parent = new Map<string, string>()
	const root = (key: string): string => {
		let at = key
		while (parent.get(at) !== at) at = parent.get(at) as string
		parent.set(key, at)
		return at
	}
	const node = (link: Link, id: string) => `${link.target}:${id}`
	for (const link of links) {
		for (const id of [link.docA, link.docB]) {
			if (!parent.has(node(link, id))) parent.set(node(link, id), node(link, id))
		}
		parent.set(root(node(link, link.docA)), root(node(link, link.docB)))
	}
	const groups = new Map<string, Link[]>()
	for (const link of [...links].sort((x, y) => y.score - x.score)) {
		const key = root(node(link, link.docA))
		groups.set(key, [...(groups.get(key) ?? []), link])
	}
	return [...groups.values()].sort((x, y) => (y[0] as Link).score - (x[0] as Link).score)
}

/** The documents of a group in the order of its pairs, the strongest first. */
const docsOf = (group: Link[]): string[] => [
	...new Set(group.flatMap((link) => [link.docA, link.docB])),
]

/**
 * The ids of documents of `target` that exist and that the reader may not read, by the
 * collection's own `read` access. A document deleted since is not among them.
 */
const unreadable = async (
	req: PayloadRequest,
	target: string,
	ids: string[]
): Promise<string[]> => {
	const config = req.payload.collections[target as CollectionSlug]?.config
	if (!config || ids.length === 0) return []
	const access = await config.access.read({ req })
	if (access === true) return []
	const find = async (where: Where[]) =>
		(
			await req.payload.find({
				collection: target as CollectionSlug,
				where: { and: [{ id: { in: ids } }, ...where] },
				select: {},
				depth: 0,
				limit: 0,
				pagination: false,
				trash: true,
				overrideAccess: true,
				req,
			})
		).docs.map((doc) => String(doc.id))
	const existing = await find([])
	if (access === false) return existing
	const readable = new Set(await find([access as Where]))
	return existing.filter((id) => !readable.has(id))
}

/** The ids among `ids` of documents of `target` in the trash. */
const inTrash = async (req: PayloadRequest, target: string, ids: string[]): Promise<string[]> => {
	const config = req.payload.collections[target as CollectionSlug]?.config
	if (!config?.trash || ids.length === 0) return []
	return (
		await req.payload.find({
			collection: target as CollectionSlug,
			where: { and: [{ id: { in: ids } }, { deletedAt: { exists: true } }] },
			select: {},
			depth: 0,
			limit: 0,
			pagination: false,
			trash: true,
			overrideAccess: true,
			req,
		})
	).docs.map((doc) => String(doc.id))
}

/**
 * The ids among `ids` of documents of `target` that the list search of the collection finds
 * for `search`, by the reader's own access, as its list view finds them.
 */
const searched = async ({
	req,
	target,
	ids,
	search,
}: {
	req: PayloadRequest
	target: string
	ids: string[]
	search: string
}): Promise<string[]> => {
	const config = req.payload.collections[target as CollectionSlug]?.config
	if (!config || ids.length === 0) return []
	return (
		await req.payload.find({
			collection: target as CollectionSlug,
			where: mergeListSearchAndWhere({
				collectionConfig: config,
				search,
				where: { id: { in: ids } },
			}),
			select: {},
			depth: 0,
			limit: 0,
			pagination: false,
			trash: true,
			overrideAccess: false,
			user: req.user,
			req,
		})
	).docs.map((doc) => String(doc.id))
}

/**
 * The queue a reviewer sees: one page of groups, every document resolved to its title under
 * the reader's own access, and the number of groups per status. Every configured collection
 * when none is named.
 */
export const readQueue = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	collection: string | null
	status: PairStatus
	search?: string
	page: number
	limit: number
}): Promise<QueueResponse> => {
	const { req, ctx, search } = args
	const collections = listCollections(ctx, req.i18n)
	const col = args.collection ? getCollectionContext(req.payload, args.collection) : null
	const targets = col ? [col.slug as string] : collections.map((entry) => entry.slug)
	if (targets.length === 0) {
		return {
			collections,
			docs: [],
			totalDocs: 0,
			page: 1,
			totalPages: 1,
			counts: emptyCounts(),
		}
	}
	const limit = pageSize(args.limit)
	// A group spans pairs on any page of them, so every pair is read, with only what grouping needs.
	const links = (
		await req.payload.db.find<Link>({
			collection: PAIRS_SLUG,
			where: {
				and: [{ target: { in: targets } }, ...tenantScope(ctx, req)],
			},
			select: {
				target: true,
				docA: true,
				docB: true,
				score: true,
				status: true,
				decidedAt: true,
			},
			limit: 0,
			pagination: false,
			req,
		})
	).docs
	// A group with a document the reader may not read, or one in the trash, is left out, and not
	// counted either: restored, it is back. A search keeps only the groups with a document it finds.
	const hidden = new Set<string>()
	const found = search ? new Set<string>() : null
	for (const target of new Set(links.map((link) => link.target))) {
		const ids = [
			...new Set(
				links.filter((link) => link.target === target).flatMap((link) => [link.docA, link.docB])
			),
		]
		for (const id of await unreadable(req, target, ids)) hidden.add(`${target}:${id}`)
		for (const id of await inTrash(req, target, ids)) hidden.add(`${target}:${id}`)
		if (found && search) {
			for (const id of await searched({ req, target, ids, search })) found.add(`${target}:${id}`)
		}
	}
	const has = (keys: Set<string>, link: Link) =>
		keys.has(`${link.target}:${link.docA}`) || keys.has(`${link.target}:${link.docB}`)
	const shownTo = (group: Link[]) =>
		group.every((link) => !has(hidden, link)) && (!found || group.some((link) => has(found, link)))
	const counts = emptyCounts()
	const byStatus = new Map<PairStatus, Link[][]>()
	for (const status of PAIR_STATUSES) {
		const groups = groupPairs(links.filter((link) => link.status === status)).filter(shownTo)
		byStatus.set(status, groups)
		counts[status] = groups.length
	}
	const groups = byStatus.get(args.status) ?? []
	const totalPages = Math.max(1, Math.ceil(groups.length / limit))
	const page = Math.min(Math.max(1, args.page), totalPages)
	const shown = groups.slice((page - 1) * limit, page * limit)

	// The strongest pair of each group tells why it matches; the last decision, who marked it.
	const latest = (group: Link[]) =>
		group.reduce<Link | undefined>(
			(last, link) =>
				link.decidedAt && (!last?.decidedAt || link.decidedAt > last.decidedAt) ? link : last,
			undefined
		)
	const wanted = shown.flatMap((group) => [group[0] as Link, latest(group)])
	const full = new Map(
		wanted.length === 0
			? []
			: (
					await req.payload.db.find<PairRow>({
						collection: PAIRS_SLUG,
						where: {
							id: { in: [...new Set(wanted.flatMap((link) => (link ? [link.id] : [])))] },
						},
						limit: 0,
						pagination: false,
						req,
					})
				).docs.map((row) => [String(row.id), row])
	)

	const titles = new Map<string, string>()
	for (const target of new Set(shown.map((group) => (group[0] as Link).target))) {
		const owner = getCollectionContext(req.payload, target)
		const ids = [...new Set(shown.filter((group) => group[0]?.target === target).flatMap(docsOf))]
		// Under the reader's own access: a document they may not read shows as its id.
		const docs = await loadDocs({ req, ctx, col: owner, ids, overrideAccess: false })
		for (const doc of docs) titles.set(`${target}:${doc.id}`, docTitle(req, owner.slug, doc))
	}
	const decided = shown.flatMap((group) => {
		const by = full.get(String(latest(group)?.id))?.decidedBy
		return by ? [by] : []
	})
	const users = await describeUsers(req, decided)
	const view: QueueGroup[] = shown.map((group) => {
		const strongest = group[0] as Link
		const { target } = strongest
		const last = full.get(String(latest(group)?.id))
		const ids = docsOf(group)
		return {
			id: String(strongest.id),
			collection: target,
			docs: ids.map((id) => ({ id, title: titles.get(`${target}:${id}`) ?? id })),
			score: strongest.score,
			signals: labelSignals(
				req,
				getCollectionContext(req.payload, target),
				full.get(String(strongest.id))?.signals ?? null
			),
			status: strongest.status,
			decidedAt: last?.decidedAt ?? null,
			decidedBy: last?.decidedBy ? (users.get(last.decidedBy) ?? last.decidedBy) : null,
		}
	})
	return {
		collections,
		docs: view,
		totalDocs: groups.length,
		page,
		totalPages,
		counts,
	}
}

const emptyCounts = (): Record<PairStatus, number> => ({ open: 0, dismissed: 0 })
