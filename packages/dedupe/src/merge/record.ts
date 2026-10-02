import { getTranslation } from '@payloadcms/translations'
import { APIError, type PayloadRequest } from 'payload'
import { toWords } from 'payload/shared'

import { MERGES_SLUG, type MergeStatus, pageSize } from '../collections/slugs'
import {
	type CollectionContext,
	listCollections,
	type PluginContext,
	tenantScope,
} from '../plugin/context'
import type { MergeDecision } from '../schema/types'
import { describeUsers, docTitle, type LoadedDoc, loadDoc, loadDocs, readableTitle } from './load'
import { type DecisionView, describeDecisions } from './planResponse'
import {
	collectionLabel,
	LISTED,
	type Repointed,
	type RepointPreview,
	readableRefs,
} from './repoint'

/** A merge record as `applyMerge` writes it. */
type MergeRow = {
	id: number | string
	target: string
	survivor: string
	absorbed: string[]
	tenant: string | null
	status: MergeStatus
	decisions: MergeDecision[] | null
	absorbedSnapshots: Record<string, LoadedDoc> | null
	repointed: Repointed | null
	appliedBy: string | null
	error: string | null
	createdAt: string
}

/** A document of a merge: still there, in the trash, or deleted. */
export type MergeDoc = { id: string; title: string; state: 'deleted' | 'live' | 'trash' }

type MergeListItem = {
	id: string
	collection: string
	survivor: MergeDoc
	absorbed: MergeDoc[]
	/** The reader may open the record; otherwise the documents show as ids and nothing else. */
	readable: boolean
	/** The user who applied it, by title, or by reference when the reader may not read them. */
	appliedBy: string | null
	createdAt: string
	status: MergeStatus
}

export type MergesResponse = {
	collections: { slug: string; label: string; hasMatch: boolean }[]
	collection: string | null
	docs: MergeListItem[]
	totalDocs: number
	page: number
	totalPages: number
}

export type MergeRecordView = MergeListItem & {
	collectionLabel: string
	error: string | null
	/** Each field with every document's value before the merge and the value it left. */
	decisions: DecisionView[]
	/** Documents elsewhere the merge moved to the survivor, per field and absorbed document. */
	moved: RepointPreview['entries']
}

type DescribedDocs = Pick<MergeListItem, 'absorbed' | 'readable' | 'survivor'> & {
	/** Documents that no longer exist and that the reader may not see: named by id, no values. */
	concealed: Set<string>
}

/**
 * Whether the reader may read every document of the collection, the only way to know they
 * may read one that no longer exists: a `Where` has nothing left to be checked against.
 */
const readsWholeCollection = async (req: PayloadRequest, col: CollectionContext) =>
	(await col.config.access.read({ req })) === true

/**
 * The documents of each record, named as the reader may read them. A document that no
 * longer exists is named from the copy the record keeps, and only to a reader of the whole
 * collection.
 */
const describeDocs = async (
	req: PayloadRequest,
	ctx: PluginContext,
	rows: MergeRow[]
): Promise<Map<string, DescribedDocs>> => {
	const described = new Map<string, DescribedDocs>()
	for (const target of new Set(rows.map((row) => row.target))) {
		const col = ctx.collections.get(target)
		if (!col) continue
		const mine = rows.filter((row) => row.target === target)
		const ids = [...new Set(mine.flatMap((row) => [row.survivor, ...row.absorbed]))]
		const existing = new Map(
			(await loadDocs({ req, ctx, col, ids, trash: true })).map((doc) => [String(doc.id), doc])
		)
		const readable = new Map(
			(await loadDocs({ req, ctx, col, ids, overrideAccess: false, trash: true })).map((doc) => [
				String(doc.id),
				docTitle(req, target, doc),
			])
		)
		const whole = await readsWholeCollection(req, col)
		for (const row of mine) {
			const group = [row.survivor, ...row.absorbed]
			const concealed = new Set(whole ? [] : group.filter((id) => !existing.has(id)))
			const describe = async (id: string): Promise<MergeDoc> => {
				const doc = existing.get(id)
				const snapshot = row.absorbedSnapshots?.[id]
				const kept = !doc && !concealed.has(id) && snapshot
				return {
					id,
					title:
						readable.get(id) ??
						(kept ? await readableTitle(req, col, { ...snapshot, id } as LoadedDoc) : id),
					state: !doc ? 'deleted' : doc.deletedAt ? 'trash' : 'live',
				}
			}
			described.set(String(row.id), {
				survivor: await describe(row.survivor),
				absorbed: await Promise.all(row.absorbed.map(describe)),
				readable: group.every((id) => !existing.has(id) || readable.has(id)),
				concealed,
			})
		}
	}
	return described
}

const listItem = (
	row: MergeRow,
	{ survivor, absorbed, readable }: DescribedDocs,
	users: Map<string, string>
): MergeListItem => ({
	id: String(row.id),
	collection: row.target,
	survivor,
	absorbed,
	readable,
	appliedBy: readable && row.appliedBy ? (users.get(row.appliedBy) ?? row.appliedBy) : null,
	createdAt: row.createdAt,
	status: row.status,
})

/** One page of merge records, newest first, of every configured collection when none is named. */
export const readMerges = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	collection: string | null
	page: number
	limit: number
}): Promise<MergesResponse> => {
	const { req, ctx } = args
	const collections = listCollections(ctx, req.i18n)
	const collection = collections.some((entry) => entry.slug === args.collection)
		? args.collection
		: null
	const targets = collection ? [collection] : collections.map((entry) => entry.slug)
	const page = Math.max(1, args.page)
	const limit = pageSize(args.limit)
	if (targets.length === 0) {
		return { collections, collection, docs: [], totalDocs: 0, page: 1, totalPages: 1 }
	}
	const result = await req.payload.db.find<MergeRow>({
		collection: MERGES_SLUG,
		where: { and: [{ target: { in: targets } }, ...tenantScope(ctx, req)] },
		sort: '-createdAt',
		limit,
		page,
		req,
	})
	const rows = result.docs
	const docs = await describeDocs(req, ctx, rows)
	const users = await describeUsers(
		req,
		rows.flatMap((row) => (row.appliedBy ? [row.appliedBy] : []))
	)
	return {
		collections,
		collection,
		docs: rows.flatMap((row) => {
			const described = docs.get(String(row.id))
			return described ? [listItem(row, described, users)] : []
		}),
		totalDocs: result.totalDocs,
		page: result.page ?? page,
		totalPages: result.totalPages,
	}
}

/**
 * One merge record in full, for a reader of every document of it that still exists: the
 * record keeps every document whole, so the collection's read access decides, as it does
 * for the plan. Fields the admin hides are shown too, since the history is what the merge
 * wrote; fields the reader may not read are not.
 */
export const readMergeRecord = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	id: string
}): Promise<MergeRecordView> => {
	const { req, ctx, id } = args
	const { locale } = req
	const found = await req.payload.db.find<MergeRow>({
		collection: MERGES_SLUG,
		where: { and: [{ id: { equals: id } }, ...tenantScope(ctx, req)] },
		limit: 1,
		pagination: false,
		req,
	})
	const row = found.docs[0]
	const col = row ? ctx.collections.get(row.target) : undefined
	if (!row || !col) throw new APIError('Merge not found.', 404, undefined, true)
	const docs = (await describeDocs(req, ctx, [row])).get(String(row.id)) as DescribedDocs
	if (!docs.readable) {
		throw new APIError('You may not read this merge.', 403, undefined, true)
	}

	const users = await describeUsers(req, row.appliedBy ? [row.appliedBy] : [])
	const moved: RepointPreview['entries'] = []
	for (const entry of row.repointed ?? []) {
		moved.push({
			collection: entry.collection,
			...(entry.global ? { global: true } : {}),
			collectionLabel: collectionLabel(req, entry),
			path: entry.path,
			label: toWords(entry.path.split('.').pop() ?? entry.path),
			from: entry.from,
			total: entry.ids.length,
			docs: await readableRefs(req, entry, entry.ids.slice(0, LISTED)),
		})
	}
	const survivor = await loadDoc({ req, ctx, col, id: row.survivor })
	// What a document the reader may not see held goes before anything is drawn from it.
	const shown = (row.decisions ?? []).map((decision) => ({
		...decision,
		values: decision.values.map((entry) =>
			docs.concealed.has(entry.doc) ? { doc: entry.doc, value: undefined } : entry
		),
		proposed: docs.concealed.has(row.survivor) ? undefined : decision.proposed,
	}))
	const decisions = await describeDecisions({
		req,
		col,
		decisions: shown,
		docs: { ...row.absorbedSnapshots, ...(survivor ? { [row.survivor]: survivor } : {}) },
		locale,
		showHidden: true,
	})

	return {
		...listItem(row, docs, users),
		collectionLabel: getTranslation(col.config.labels.singular, req.i18n),
		error: row.error,
		decisions,
		moved,
	}
}
