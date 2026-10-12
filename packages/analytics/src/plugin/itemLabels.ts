import type { CollectionSlug, PayloadRequest } from 'payload'
import { itemCollectionsOf } from '../binding/report'
import { isCollectionSlug } from '../core/collectionSlug'
import type { AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { itemIdTypeOf } from '../items/collectionIdType'
import { fitsIdType } from '../items/idType'
import { itemDocumentId, parseItemRef } from '../items/ref'
import type { ItemLabels } from '../query/response'
import { getRuntime } from './runtime'

/** More than any read the view makes names; a request naming more gets the rest as hidden. */
const MAX_LABELLED_REFS = 600

/** Every item ref a read names: its `item`, its item filters and the item rows of its results. */
export const itemRefsOf = (
	query: Pick<AnalyticsQuery, 'item' | 'filters'>,
	results: ReadonlyArray<AnalyticsResult | undefined>
): string[] => {
	const refs = new Set<string>()
	if (query.item !== undefined) {
		refs.add(query.item)
	}
	for (const filter of query.filters ?? []) {
		if (filter.dimension === 'item') {
			refs.add(filter.value)
		}
	}
	for (const result of results) {
		for (const row of result?.rows ?? []) {
			const ref = row.dimensions?.item
			if (ref) {
				refs.add(ref)
			}
		}
	}
	return [...refs]
}

/** A title as the admin would show it; an empty one falls back to the document's id. */
const titleOf = (doc: object, field: string, id: string): string => {
	const value: unknown = Reflect.get(doc, field)
	if (typeof value === 'string' && value.trim() !== '') {
		return value.trim()
	}
	return typeof value === 'number' ? String(value) : id
}

interface TitleSource {
	collection: CollectionSlug
	titleField: string
}

const findTitles = async (
	req: PayloadRequest,
	{ collection, titleField }: TitleSource,
	ids: string[]
): Promise<Map<string, string>> => {
	const { docs } = await req.payload.find({
		collection,
		where: { id: { in: ids } },
		select: { [titleField]: true },
		depth: 0,
		pagination: false,
		overrideAccess: false,
		user: req.user,
		req,
	})
	const titles = new Map<string, string>()
	for (const doc of docs) {
		const id = String(doc.id)
		titles.set(id, titleOf(doc, titleField, id))
	}
	return titles
}

/** Failed lookups in a row that say the database refuses everything, not one id. */
const MAX_FAILED_IN_A_ROW = 2

/** Each id asked alone after a failed batch, until `MAX_FAILED_IN_A_ROW` refusals in a row. */
const titlesOneByOne = async (
	req: PayloadRequest,
	source: TitleSource,
	ids: string[]
): Promise<{ titles: Map<string, string>; unread: number }> => {
	const titles = new Map<string, string>()
	let unread = 0
	// A lone id was the whole batch, so asking it again would only fail again.
	let inARow = ids.length > 1 ? 0 : MAX_FAILED_IN_A_ROW
	for (const id of ids) {
		if (inARow >= MAX_FAILED_IN_A_ROW) {
			unread++
			continue
		}
		try {
			for (const [found, title] of await findTitles(req, source, [id])) {
				titles.set(found, title)
			}
			inARow = 0
		} catch {
			inARow++
			unread++
		}
	}
	return { titles, unread }
}

/**
 * Titles of one collection's documents in one query. If the database refuses it, each id is asked
 * alone so only the refused one goes untitled; two refusals in a row stop that.
 */
const titlesOf = async (
	req: PayloadRequest,
	collection: CollectionSlug,
	ids: string[]
): Promise<Map<string, string>> => {
	const source: TitleSource = {
		collection,
		titleField: req.payload.collections[collection]?.config.admin?.useAsTitle ?? 'id',
	}
	try {
		return await findTitles(req, source, ids)
	} catch (err) {
		const { titles, unread } = await titlesOneByOne(req, source, ids)
		if (unread > 0) {
			req.payload.logger?.warn(
				`analytics: ${unread} of ${ids.length} item titles could not be read for "${collection}": ${String(err)}`
			)
		}
		return titles
	}
}

/**
 * Titles behind refs, read as the requesting user; anything unresolvable maps to `null`, never the
 * ref. An id unfit for its collection is never sent: a casting database fails the whole query.
 */
export const resolveItemLabels = async (
	req: PayloadRequest,
	refs: readonly string[]
): Promise<ItemLabels> => {
	const labels: ItemLabels = {}
	const runtime = getRuntime(req.payload)
	const bound = runtime ? itemCollectionsOf(runtime.bindings) : new Set<string>()
	const wanted = new Map<CollectionSlug, Map<string, string[]>>()
	for (const [index, ref] of refs.entries()) {
		labels[ref] = null
		const parts = parseItemRef(ref)
		if (
			index >= MAX_LABELLED_REFS ||
			!parts ||
			!bound.has(parts.collection) ||
			!isCollectionSlug(req.payload, parts.collection)
		) {
			continue
		}
		const id = itemDocumentId(parts)
		if (!fitsIdType(id, itemIdTypeOf(req.payload, parts.collection))) {
			continue
		}
		const ids = wanted.get(parts.collection) ?? new Map<string, string[]>()
		ids.set(id, [...(ids.get(id) ?? []), ref])
		wanted.set(parts.collection, ids)
	}
	await Promise.all(
		[...wanted].map(async ([collection, ids]) => {
			for (const [id, title] of await titlesOf(req, collection, [...ids.keys()])) {
				for (const ref of ids.get(id) ?? []) {
					labels[ref] = title
				}
			}
		})
	)
	return labels
}
