import type { CollectionSlug, PayloadRequest, Where } from 'payload'

import { PAIR_STATUSES, PAIRS_SLUG } from '../collections/slugs'
import type { PairRow } from './pairs'

/** Ids per query or write, well under Postgres' limit on bound parameters in one statement. */
const CHUNK = 1000

/**
 * Pairs without a lead above which the whole collection is settled in one read rather than
 * group by group: that many are pairs stored before leads were, not a write that missed one.
 */
const SETTLE_ALL_ABOVE = 500

/** A pair with what grouping needs. `lead` is unset on a pair no regroup has reached yet. */
export type GroupLink = Pick<
	PairRow,
	'id' | 'target' | 'docA' | 'docB' | 'score' | 'status' | 'decidedAt'
> & { lead?: boolean | null }

const LINK_SELECT = {
	target: true,
	docA: true,
	docB: true,
	score: true,
	status: true,
	decidedAt: true,
	lead: true,
} as const

const chunksOf = <T>(items: T[]): T[][] =>
	Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, index) =>
		items.slice(index * CHUNK, (index + 1) * CHUNK)
	)

/** The higher score first, then the lower id, so a group's lead does not flip between equals. */
export const byStrength = (x: GroupLink, y: GroupLink): number =>
	y.score - x.score || String(x.id).localeCompare(String(y.id))

/** The documents `links` name, in the order of the links. */
export const docsOfLinks = (links: GroupLink[]): string[] => [
	...new Set(links.flatMap((link) => [link.docA, link.docB])),
]

/**
 * Links of one status as groups: the documents linked by pairs in a chain (A like B, B like C).
 * The strongest group first, and in each group its pairs strongest first.
 */
export const groupLinks = (links: GroupLink[]): GroupLink[][] => {
	const parent = new Map<string, string>()
	const root = (key: string): string => {
		let at = key
		while (parent.get(at) !== at) at = parent.get(at) as string
		parent.set(key, at)
		return at
	}
	const node = (link: GroupLink, id: string) => `${link.target}:${id}`
	for (const link of links) {
		for (const id of [link.docA, link.docB]) {
			if (!parent.has(node(link, id))) parent.set(node(link, id), node(link, id))
		}
		parent.set(root(node(link, link.docA)), root(node(link, link.docB)))
	}
	const groups = new Map<string, GroupLink[]>()
	for (const link of [...links].sort(byStrength)) {
		const key = root(node(link, link.docA))
		groups.set(key, [...(groups.get(key) ?? []), link])
	}
	return [...groups.values()].sort((x, y) => byStrength(x[0] as GroupLink, y[0] as GroupLink))
}

/** The ids among `ids` of documents of `target` in the trash. */
export const inTrash = async (
	req: PayloadRequest,
	target: string,
	ids: string[]
): Promise<string[]> => {
	const config = req.payload.collections[target as CollectionSlug]?.config
	if (!config?.trash || ids.length === 0) return []
	const found: string[] = []
	for (const chunk of chunksOf(ids)) {
		const { docs } = await req.payload.find({
			collection: target as CollectionSlug,
			where: { and: [{ id: { in: chunk } }, { deletedAt: { exists: true } }] },
			select: {},
			depth: 0,
			limit: 0,
			pagination: false,
			trash: true,
			overrideAccess: true,
			req,
		})
		found.push(...docs.map((doc) => String(doc.id)))
	}
	return found
}

/** The links among `links` that name no document in `trashed`: those the queue shows. */
export const visibleLinks = (links: GroupLink[], trashed: Set<string>): GroupLink[] =>
	links.filter((link) => !trashed.has(link.docA) && !trashed.has(link.docB))

/**
 * Every pair of `target` reachable from `docIds`, however far a chain runs: their whole groups.
 * Each round reads the pairs of the documents the round before reached. `where` narrows the
 * pairs walked, to one status or one tenant.
 */
export const collectLinks = async (args: {
	req: PayloadRequest
	target: string
	docIds: string[]
	where?: Where[]
}): Promise<GroupLink[]> => {
	const { req, target, where = [] } = args
	const reached = new Set(args.docIds)
	const links = new Map<string, GroupLink>()
	let frontier = [...reached]
	while (frontier.length > 0) {
		const found: GroupLink[] = []
		for (const chunk of chunksOf(frontier)) {
			const { docs } = await req.payload.db.find<GroupLink>({
				collection: PAIRS_SLUG,
				where: {
					and: [
						{ target: { equals: target } },
						...where,
						{ or: [{ docA: { in: chunk } }, { docB: { in: chunk } }] },
					],
				},
				select: LINK_SELECT,
				limit: 0,
				pagination: false,
				req,
			})
			found.push(...docs)
		}
		for (const link of found) links.set(String(link.id), link)
		frontier = docsOfLinks(found).filter((id) => !reached.has(id))
		for (const id of frontier) reached.add(id)
	}
	return [...links.values()]
}

/**
 * Marks the strongest pair of every group among `links` as its lead and every other pair not,
 * writing only the pairs whose mark changes. The queue pages through leads, so it never reads
 * the pairs of groups it does not show. A pair naming a document in the trash leads and links
 * nothing until the document comes back. `links` must hold whole groups.
 */
const writeLeads = async (
	req: PayloadRequest,
	links: GroupLink[],
	trashed: Set<string>
): Promise<void> => {
	const visible = visibleLinks(links, trashed)
	const leads = new Set<string>()
	for (const status of PAIR_STATUSES) {
		for (const group of groupLinks(visible.filter((link) => link.status === status))) {
			leads.add(String(group[0]?.id))
		}
	}
	const raise = links.filter((link) => leads.has(String(link.id)) && link.lead !== true)
	const lower = links.filter((link) => !leads.has(String(link.id)) && link.lead !== false)
	for (const [changed, lead] of [
		[raise, true],
		[lower, false],
	] as const) {
		for (const chunk of chunksOf(changed.map((link) => link.id))) {
			await req.payload.db.updateMany({
				collection: PAIRS_SLUG,
				where: { id: { in: chunk } },
				data: { lead },
				req,
			})
		}
	}
}

/**
 * Settles the leads of the groups of `docIds`, in every status, after a write that may have
 * joined, split or reordered them. Runs through `req`, inside the write's transaction.
 */
export const regroup = async (args: {
	req: PayloadRequest
	target: string
	docIds: (number | string)[]
}): Promise<void> => {
	const { req, target } = args
	const docIds = [...new Set(args.docIds.map(String))]
	if (docIds.length === 0) return
	const links = await collectLinks({ req, target, docIds })
	const trashed = new Set(await inTrash(req, target, docsOfLinks(links)))
	await writeLeads(req, links, trashed)
}

/** Settles every group of `target` from one read of its pairs: after a scan wrote many. */
export const regroupAll = async (args: { req: PayloadRequest; target: string }): Promise<void> => {
	const { req, target } = args
	const { docs: links } = await req.payload.db.find<GroupLink>({
		collection: PAIRS_SLUG,
		where: { target: { equals: target } },
		select: LINK_SELECT,
		limit: 0,
		pagination: false,
		req,
	})
	const trashed = new Set(await inTrash(req, target, docsOfLinks(links)))
	await writeLeads(req, links, trashed)
}

/**
 * Settles the groups of pairs that have no lead yet: pairs stored before the plugin kept
 * leads, or written by a scan still running. The queue runs it before reading, so such pairs
 * show up without waiting for the next scan.
 */
export const settleUnled = async (args: { req: PayloadRequest; target: string }): Promise<void> => {
	const { req, target } = args
	const where: Where = { and: [{ target: { equals: target } }, { lead: { exists: false } }] }
	const { totalDocs } = await req.payload.db.count({ collection: PAIRS_SLUG, where, req })
	if (totalDocs === 0) return
	if (totalDocs > SETTLE_ALL_ABOVE) {
		await regroupAll({ req, target })
		return
	}
	const { docs } = await req.payload.db.find<GroupLink>({
		collection: PAIRS_SLUG,
		where,
		select: LINK_SELECT,
		limit: 0,
		pagination: false,
		req,
	})
	await regroup({ req, target, docIds: docsOfLinks(docs) })
}
