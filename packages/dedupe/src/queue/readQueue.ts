import type { CollectionSlug, PayloadRequest, Where } from 'payload'
import { mergeListSearchAndWhere } from 'payload/shared'

import { PAIR_STATUSES, PAIRS_SLUG, type PairStatus, pageSize } from '../collections/slugs'
import { describeUsers, docTitle, loadDocs } from '../merge/load'
import {
	getCollectionContext,
	listCollections,
	type PluginContext,
	tenantScope,
} from '../plugin/context'
import {
	byStrength,
	collectLinks,
	docsOfLinks,
	type GroupLink,
	groupLinks,
	inTrash,
	settleUnled,
	visibleLinks,
} from './groups'
import { labelSignals, type PairRow, type SignalView } from './pairs'

/**
 * Documents a search looks at, the best match first. A search finding more names a word too
 * common to review by; the reviewer narrows it.
 */
export const SEARCH_LIMIT = 250

const LEAD_SELECT = {
	target: true,
	docA: true,
	docB: true,
	score: true,
	status: true,
	lead: true,
} as const

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

/** Documents the reader may not read, as `target:id`, and the leads of the groups holding them. */
type Hidden = { docs: Set<string>; leads: Set<string> }

const emptyCounts = (): Record<PairStatus, number> => ({ open: 0, dismissed: 0 })

const keyOf = (target: string, id: string): string => `${target}:${id}`

const touches = (group: GroupLink[], docs: Set<string>): boolean =>
	group.some(
		(link) => docs.has(keyOf(link.target, link.docA)) || docs.has(keyOf(link.target, link.docB))
	)

/**
 * The ids among `ids` of documents of `target` that exist and that the reader may not read, by
 * the collection's own `read` access. A document deleted since is not among them.
 */
const unreadable = async (args: {
	req: PayloadRequest
	target: string
	ids: string[]
	access: Where | false
}): Promise<string[]> => {
	const { req, target, ids, access } = args
	if (ids.length === 0) return []
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
	const readable = new Set(await find([access]))
	return existing.filter((id) => !readable.has(id))
}

/**
 * What the queue keeps from a reader whose `read` access on a collection is narrower than all
 * of it: every group with a document they may not read. Nothing to look up for a reader who
 * reads every document, as most reviewers do; for the others every pair's documents are read.
 */
const findHidden = async (
	req: PayloadRequest,
	targets: string[],
	scope: Where[]
): Promise<Hidden> => {
	const hidden: Hidden = { docs: new Set(), leads: new Set() }
	for (const target of targets) {
		const config = req.payload.collections[target as CollectionSlug]?.config
		if (!config) continue
		const access = await config.access.read({ req })
		if (access === true) continue
		const { docs: pairs } = await req.payload.db.find<GroupLink>({
			collection: PAIRS_SLUG,
			where: { and: [{ target: { equals: target } }, ...scope] },
			select: { docA: true, docB: true },
			limit: 0,
			pagination: false,
			req,
		})
		const ids = docsOfLinks(pairs)
		const refused = await unreadable({ req, target, ids, access: access as Where | false })
		if (refused.length === 0) continue
		for (const id of refused) hidden.docs.add(keyOf(target, id))
		for (const link of await collectLinks({ req, target, docIds: refused, where: scope })) {
			if (link.lead) hidden.leads.add(String(link.id))
		}
	}
	return hidden
}

/**
 * The documents of `target` a search finds: the adapter's own search where it has one, else
 * the collection's list search under the reader's access, as its list view searches.
 */
const searchDocs = async (req: PayloadRequest, target: string, search: string) => {
	const col = getCollectionContext(req.payload, target)
	if (col.adapter.search) {
		const hits = await col.adapter.search({ req, collection: target, search, limit: SEARCH_LIMIT })
		return hits.map((hit) => String(hit.id))
	}
	const config = req.payload.collections[target as CollectionSlug]?.config
	if (!config) return []
	const { docs } = await req.payload.find({
		collection: target as CollectionSlug,
		where: mergeListSearchAndWhere({ collectionConfig: config, search }),
		select: {},
		depth: 0,
		limit: SEARCH_LIMIT,
		pagination: false,
		trash: true,
		overrideAccess: false,
		user: req.user,
		req,
	})
	return docs.map((doc) => String(doc.id))
}

/** Per status, the groups holding a document a search finds, the strongest first. */
const searchGroups = async (args: {
	req: PayloadRequest
	targets: string[]
	search: string
	scope: Where[]
	hidden: Hidden
}): Promise<Record<PairStatus, GroupLink[][]>> => {
	const { req, targets, search, scope, hidden } = args
	const found: Record<PairStatus, GroupLink[][]> = { open: [], dismissed: [] }
	for (const target of targets) {
		const ids = await searchDocs(req, target, search)
		if (ids.length === 0) continue
		const docs = new Set(ids.map((id) => keyOf(target, id)))
		for (const status of PAIR_STATUSES) {
			const where = [{ status: { equals: status } }, ...scope]
			const links = await collectLinks({ req, target, docIds: ids, where })
			const trashed = new Set(await inTrash(req, target, docsOfLinks(links)))
			for (const group of groupLinks(visibleLinks(links, trashed))) {
				if (touches(group, docs) && !touches(group, hidden.docs)) found[status].push(group)
			}
		}
	}
	for (const status of PAIR_STATUSES) {
		found[status].sort((x, y) => byStrength(x[0] as GroupLink, y[0] as GroupLink))
	}
	return found
}

/** The groups `leads` lead, in the order of `leads`, each its pairs strongest first. */
const groupsLedBy = async (
	req: PayloadRequest,
	leads: GroupLink[],
	scope: Where[]
): Promise<GroupLink[][]> => {
	const byLead = new Map<string, GroupLink[]>()
	for (const target of new Set(leads.map((lead) => lead.target))) {
		for (const status of PAIR_STATUSES) {
			const own = leads.filter((lead) => lead.target === target && lead.status === status)
			if (own.length === 0) continue
			const where = [{ status: { equals: status } }, ...scope]
			const links = await collectLinks({ req, target, docIds: docsOfLinks(own), where })
			const trashed = new Set(await inTrash(req, target, docsOfLinks(links)))
			for (const group of groupLinks(visibleLinks(links, trashed))) {
				for (const link of group) byLead.set(String(link.id), group)
			}
		}
	}
	return leads.map((lead) => byLead.get(String(lead.id)) ?? [lead])
}

/**
 * The queue a reviewer sees: one page of groups, every document resolved to its title under
 * the reader's own access, and the number of groups per status. Every configured collection
 * when none is named.
 *
 * Every group keeps its strongest pair marked as its lead (`groups.ts`), so a page is a page of
 * leads read from the database, and only the shown groups' pairs are walked. A search walks the
 * groups of the documents it finds.
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
	const { req, ctx } = args
	const search = args.search?.trim() ?? ''
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
	for (const target of targets) await settleUnled({ req, target })
	const scope = tenantScope(ctx, req)
	// A group with a document the reader may not read, or one in the trash, is left out, and not
	// counted either: restored, it is back.
	const hidden = await findHidden(req, targets, scope)

	const leadsOf = (status: PairStatus): Where => ({
		and: [
			{ target: { in: targets } },
			{ status: { equals: status } },
			{ lead: { equals: true } },
			...(hidden.leads.size > 0 ? [{ id: { not_in: [...hidden.leads] } }] : []),
			...scope,
		],
	})
	const found = search ? await searchGroups({ req, targets, search, scope, hidden }) : null
	const counts = emptyCounts()
	for (const status of PAIR_STATUSES) {
		counts[status] = found
			? found[status].length
			: (await req.payload.db.count({ collection: PAIRS_SLUG, where: leadsOf(status), req }))
					.totalDocs
	}
	const total = counts[args.status]
	const totalPages = Math.max(1, Math.ceil(total / limit))
	const page = Math.min(Math.max(1, args.page), totalPages)
	const shown = found
		? found[args.status].slice((page - 1) * limit, page * limit)
		: await groupsLedBy(
				req,
				(
					await req.payload.db.find<GroupLink>({
						collection: PAIRS_SLUG,
						where: leadsOf(args.status),
						select: LEAD_SELECT,
						sort: ['-score', 'id'],
						limit,
						page,
						pagination: true,
						req,
					})
				).docs,
				scope
			)

	// The strongest pair of each group tells why it matches; the last decision, who marked it.
	const latest = (group: GroupLink[]) =>
		group.reduce<GroupLink | undefined>(
			(last, link) =>
				link.decidedAt && (!last?.decidedAt || link.decidedAt > last.decidedAt) ? link : last,
			undefined
		)
	const wanted = shown.flatMap((group) => [group[0] as GroupLink, latest(group)])
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
	for (const target of new Set(shown.map((group) => (group[0] as GroupLink).target))) {
		const owner = getCollectionContext(req.payload, target)
		const ids = docsOfLinks(shown.filter((group) => group[0]?.target === target).flat())
		// Under the reader's own access: a document they may not read shows as its id.
		const docs = await loadDocs({ req, ctx, col: owner, ids, overrideAccess: false })
		for (const doc of docs)
			titles.set(keyOf(target, String(doc.id)), docTitle(req, owner.slug, doc))
	}
	const decided = shown.flatMap((group) => {
		const by = full.get(String(latest(group)?.id))?.decidedBy
		return by ? [by] : []
	})
	const users = await describeUsers(req, decided)
	const view: QueueGroup[] = shown.map((group) => {
		const strongest = group[0] as GroupLink
		const { target } = strongest
		const last = full.get(String(latest(group)?.id))
		return {
			id: String(strongest.id),
			collection: target,
			docs: docsOfLinks(group).map((id) => ({ id, title: titles.get(keyOf(target, id)) ?? id })),
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
		totalDocs: total,
		page,
		totalPages,
		counts,
	}
}
