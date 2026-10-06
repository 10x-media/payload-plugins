import {
	APIError,
	type CollectionSlug,
	isolateObjectProperty,
	type PayloadRequest,
	parseDocumentID,
	type Where,
} from 'payload'

import { PAIRS_SLUG } from '../collections/slugs'
import { pairKeyFor } from '../match/keys'
import { type CollectionContext, type PluginContext, tenantOf } from '../plugin/context'
import { fieldReadable } from './access'
import { isEmpty } from './compare'

export type LoadedDoc = Record<string, unknown> & { id: number | string }

/** The collection's `useAsTitle`; an upload collection without one is named by its file. */
const titleField = (req: PayloadRequest, slug: string): string => {
	const config = req.payload.collections[slug as CollectionSlug]?.config
	const field = config?.admin.useAsTitle
	if (typeof field === 'string' && field !== '' && field !== 'id') return field
	return config?.upload ? 'filename' : 'id'
}

/**
 * A readable title for a document, from the collection's `useAsTitle`: in the reader's
 * locale, or the default one where the reader's has none.
 */
export const docTitle = (
	req: PayloadRequest,
	slug: string,
	doc: Record<string, unknown>
): string => {
	const value = doc[titleField(req, slug)]
	const { localization } = req.payload.config
	if (value !== null && typeof value === 'object' && !Array.isArray(value) && localization) {
		const locales = [req.locale, localization.defaultLocale].filter(
			(locale): locale is string => typeof locale === 'string' && locale !== 'all'
		)
		for (const locale of locales) {
			const localized = (value as Record<string, unknown>)[locale]
			if (!isEmpty(localized)) return String(localized)
		}
		return String(doc.id)
	}
	return isEmpty(value) ? String(doc.id) : String(value)
}

/**
 * `docTitle` of a document read past access control: its id to a reader who may not read the
 * title field of this document, as Payload leaves that field out for them.
 */
export const readableTitle = async (
	req: PayloadRequest,
	col: CollectionContext,
	doc: LoadedDoc
): Promise<string> => {
	const field = titleField(req, col.slug)
	if (field !== 'id' && !(await fieldReadable(req, { col, path: field, doc })))
		return String(doc.id)
	return docTitle(req, col.slug, doc)
}

/**
 * The request for a Local API call that names its own locale, depth or context. Payload
 * writes them onto the request it is given, and that request may be the host's, used by
 * several of these at once and handed to the host's event handlers afterwards. Each call
 * gets its own `locale`, `fallbackLocale`, `query` and `context`, so its hooks see what it
 * reads or writes with; the rest, the transaction included, stays the original's.
 */
export const localRequest = (req: PayloadRequest): PayloadRequest => {
	const local = isolateObjectProperty(req, ['locale', 'fallbackLocale', 'query', 'context'])
	local.query = { ...(req.query ?? {}) }
	return local
}

/**
 * Whether merging the published state would publish a draft nobody reviewed: Payload writes on
 * top of the latest version, and the survivor's is a draft newer than what is published.
 */
export const survivorHasDraft = async (args: {
	req: PayloadRequest
	col: CollectionContext
	id: number | string
}): Promise<boolean> => {
	const { req, col, id } = args
	if (!col.hasDrafts || col.options.draft) return false
	const latest = await req.payload.findByID({
		collection: col.slug,
		id,
		depth: 0,
		draft: true,
		overrideAccess: true,
		disableErrors: true,
		req: localRequest(req),
	})
	return latest?._status === 'draft'
}

/**
 * A document as the planner and the scorer need it: every locale, nothing populated,
 * the state the collection is configured to merge. Trashed documents are returned so a
 * caller can refuse them with a reason instead of a 404.
 */
export const loadDoc = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	id: number | string
}): Promise<LoadedDoc | null> => {
	const { req, ctx, col, id } = args
	const doc = await req.payload.findByID({
		collection: col.slug,
		id,
		depth: 0,
		...(ctx.localeCodes ? { locale: 'all' } : {}),
		draft: col.hasDrafts && col.options.draft,
		trash: true,
		overrideAccess: true,
		disableErrors: true,
		req: localRequest(req),
	})
	return (doc as LoadedDoc | null) ?? null
}

export const loadDocs = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	ids: (number | string)[]
	/** `false` reads as the request's user, leaving out what they may not read. */
	overrideAccess?: boolean
	/** Trashed documents too, such as the absorbed side of a merged pair. */
	trash?: boolean
	/** Fields hidden from the API too, for the copy a merge record keeps. */
	showHiddenFields?: boolean
}): Promise<LoadedDoc[]> => {
	const { req, ctx, col, ids, overrideAccess = true, trash = false, showHiddenFields } = args
	if (ids.length === 0) return []
	const result = await req.payload.find({
		collection: col.slug,
		where: { id: { in: ids } },
		depth: 0,
		limit: ids.length,
		pagination: false,
		...(ctx.localeCodes ? { locale: 'all' } : {}),
		draft: col.hasDrafts && col.options.draft,
		trash,
		overrideAccess,
		...(showHiddenFields ? { showHiddenFields } : {}),
		// A collection the user may not read at all answers empty rather than Forbidden.
		...(overrideAccess ? {} : { user: req.user, disableErrors: true }),
		req: localRequest(req),
	})
	return result.docs as LoadedDoc[]
}

type MergeGroupDocs = { survivor: LoadedDoc; absorbed: LoadedDoc[] }

const badRequest = (message: string): Error => new APIError(message, 400, undefined, true)

/**
 * What can be refused without reading anything: no absorbed document, one listed twice,
 * more than `maxGroupSize`. Checked before any access check, which costs a query per id.
 */
export const checkGroup = (args: {
	ctx: PluginContext
	survivorId: number | string
	absorbedIds: (number | string)[]
}): void => {
	const { ctx, survivorId, absorbedIds } = args
	const ids = [survivorId, ...absorbedIds].map(String)
	if (absorbedIds.length === 0) throw badRequest('A merge needs at least one absorbed document.')
	if (new Set(ids).size !== ids.length) {
		throw badRequest('A document is listed twice, or merged into itself.')
	}
	if (ids.length > ctx.options.maxGroupSize) {
		throw badRequest(`A merge takes at most ${ctx.options.maxGroupSize} documents.`)
	}
}

/**
 * A document the plugin compares: not in the trash, and published when it merges the
 * published state. Only an explicit draft is left out: a status cleared to nothing counts as
 * published, as in Payload's access examples.
 */
export const isLive = (col: CollectionContext, doc: LoadedDoc): boolean => {
	if (doc.deletedAt) return false
	if (col.hasDrafts && !col.options.draft && doc._status === 'draft') return false
	return true
}

/**
 * The documents of one merge, the survivor and the ones it absorbs, each checked: every
 * document exists, none is in the trash, and all share a tenant. `checkGroup` runs first.
 */
export const loadMergeGroup = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	survivorId: number | string
	absorbedIds: (number | string)[]
}): Promise<MergeGroupDocs> => {
	const { req, col, survivorId, absorbedIds } = args
	const ids = [survivorId, ...absorbedIds].map(String)
	const docs = await Promise.all(ids.map((id) => loadDoc({ ...args, id })))
	for (const [index, doc] of docs.entries()) {
		if (!doc) throw new APIError(`Document ${ids[index]} does not exist.`, 404, undefined, true)
		if (doc.deletedAt) {
			throw new APIError(
				`"${await readableTitle(req, col, doc)}" is in the trash.`,
				409,
				undefined,
				true
			)
		}
		// What is merged is the published state, and a document never published has none: its
		// main row still holds its first draft.
		if (!isLive(col, doc)) {
			throw new APIError(
				`"${await readableTitle(req, col, doc)}" is not published.`,
				409,
				undefined,
				true
			)
		}
	}
	const [survivor, ...absorbed] = docs as LoadedDoc[]
	if (
		absorbed.some(
			(doc) =>
				tenantOf(req.payload, col.slug, doc) !==
				tenantOf(req.payload, col.slug, survivor as LoadedDoc)
		)
	) {
		throw badRequest('The documents belong to different tenants.')
	}
	return { survivor: survivor as LoadedDoc, absorbed }
}

/**
 * The collection's own access control for one document. A boolean answers directly; a
 * `Where` is checked against the document, which is how Payload itself resolves it.
 */
export const docAllowed = async (args: {
	req: PayloadRequest
	col: CollectionContext
	operation: 'delete' | 'read' | 'update'
	id: number | string
	/** What Payload hands the check: a move to the trash asks `delete` with the `deletedAt` it sets. */
	data?: Record<string, unknown>
}): Promise<boolean> => {
	const { req, col, operation, data } = args
	// In the form Payload hands it over: a number on SQL, as the endpoints read it a string.
	const id = parseDocumentID({ id: args.id, collectionSlug: col.slug, payload: req.payload })
	const access = col.config.access[operation]
	const result = await access({ req, id, data })
	if (typeof result === 'boolean') return result
	const count = await req.payload.count({
		collection: col.slug,
		where: { and: [{ id: { equals: id } }, result as Where] },
		overrideAccess: true,
		trash: true,
		req,
	})
	return count.totalDocs > 0
}

export const READ_REFUSED = 'You may not read one of these documents.'

/** Whether the collection's own access lets the reader read every one of `ids`. */
export const allReadable = async (args: {
	req: PayloadRequest
	col: CollectionContext
	ids: (number | string)[]
}): Promise<boolean> => {
	for (const id of args.ids) {
		if (!(await docAllowed({ ...args, operation: 'read', id }))) return false
	}
	return true
}

/** Whether Payload validates the merge's write: not a draft, unless drafts are validated. */
export const validatesWrite = (col: CollectionContext): boolean => {
	const drafts = col.config.versions?.drafts
	const draft = col.hasDrafts && col.options.draft
	return !draft || (typeof drafts === 'object' && drafts.validate === true)
}

/** The absorbed ids, the one whose pair with the survivor scores highest first. */
export const bySimilarity = async (args: {
	req: PayloadRequest
	col: CollectionContext
	survivorId: number | string
	absorbedIds: (number | string)[]
}): Promise<string[]> => {
	const { req, col, survivorId, absorbedIds } = args
	const keyOf = (id: number | string) => pairKeyFor(col.slug, survivorId, id)
	const { docs } = await req.payload.db.find<{ pairKey: string; score: number }>({
		collection: PAIRS_SLUG,
		where: { pairKey: { in: absorbedIds.map(keyOf) } },
		limit: 0,
		pagination: false,
		req,
	})
	const score = new Map(docs.map((pair) => [pair.pairKey, pair.score]))
	return absorbedIds
		.map(String)
		.sort((a, b) => (score.get(keyOf(b)) ?? -1) - (score.get(keyOf(a)) ?? -1))
}

/**
 * Users named by the title of their document, where the reader may read it; `refs` are
 * `collection:id`, as `userRef` writes them.
 */
export const describeUsers = async (
	req: PayloadRequest,
	refs: string[]
): Promise<Map<string, string>> => {
	const titles = new Map<string, string>()
	const bySlug = new Map<string, string[]>()
	for (const ref of new Set(refs)) {
		const cut = ref.indexOf(':')
		const slug = ref.slice(0, cut)
		if (cut === -1 || !req.payload.collections[slug as CollectionSlug]) continue
		bySlug.set(slug, [...(bySlug.get(slug) ?? []), ref.slice(cut + 1)])
	}
	for (const [slug, ids] of bySlug) {
		const result = await req.payload.find({
			collection: slug as CollectionSlug,
			where: { id: { in: ids } },
			depth: 0,
			limit: ids.length,
			pagination: false,
			overrideAccess: false,
			user: req.user,
			disableErrors: true,
			req,
		})
		for (const doc of result.docs as LoadedDoc[]) {
			titles.set(`${slug}:${String(doc.id)}`, docTitle(req, slug, doc))
		}
	}
	return titles
}
