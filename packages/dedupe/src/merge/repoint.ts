import { getTranslation } from '@payloadcms/translations'
import {
	APIError,
	type CollectionSlug,
	type GlobalSlug,
	type PayloadRequest,
	ValidationError,
	type Where,
} from 'payload'
import { toWords } from 'payload/shared'

import { type CollectionContext, dedupeContext, type PluginContext } from '../plugin/context'
import { localizedSegment, pathIsAmbiguous, pathQueryable } from '../schema/references'
import type { ReferenceSpec } from '../schema/types'
import { readPath, relationId } from './compare'
import { docTitle, localRequest } from './load'

/** Past this many documents a merge is not two records meeting; refuse rather than run for minutes. */
const REPOINT_LIMIT = 1000

/** The published state; a document saved before drafts were turned on has no status and counts. */
const PUBLISHED: Where = {
	or: [{ _status: { equals: 'published' } }, { _status: { exists: false } }],
}

/** Documents per page when a collection is read whole to find what points at the group. */
const SCAN_PAGE = 500

/** What reading whole collections found for a preview, so each is read once per locale and state. */
type Scan = { ids: string[]; found: Map<string, Row[]> }

/** Documents listed per reference on the merge screen; the count covers the rest. */
export const LISTED = 10

type Row = Record<string, unknown> & { id: number | string; _status?: string }

export type RepointDocRef = { id: string; title: string }

/** The documents of one collection, or a global, that point at a document through one field. */
export type LinkedFrom = {
	collection: string
	/** `collection` is a global; its one document's id is its slug. */
	global?: boolean
	collectionLabel: string
	path: string
	label: string
	total: number
	/** The first `LISTED` of them. */
	docs: RepointDocRef[]
}

export type RepointPreview = {
	/**
	 * One per reference and absorbed document that has documents to move. A document a move
	 * would make collide is left out here and listed in its conflict only.
	 */
	entries: (LinkedFrom & {
		/** The absorbed document the documents point at now. */
		from: string
	})[]
	/**
	 * Documents a move would make collide on a unique field or index, each with the document
	 * of the group it points at now: the survivor's own, or one per absorbed document.
	 */
	conflicts: {
		collection: string
		collectionLabel: string
		fields: string[]
		docs: { owner: string; doc: RepointDocRef }[]
	}[]
	/** What stops the move altogether until someone deals with it. */
	blockers: (
		| {
				reason: 'pendingDraft'
				collection: string
				global?: boolean
				collectionLabel: string
				doc: RepointDocRef
		  }
		| { reason: 'tooMany'; count: number }
	)[]
	/** The documents that point at each document of the group, by its id, one entry per field. */
	linked: Record<string, LinkedFrom[]>
}

/** What the merge record keeps: which documents were moved, per reference and absorbed document. */
export type Repointed = {
	collection: string
	global?: boolean
	path: string
	from: string
	ids: string[]
}[]

export type RepointFound = { ref: ReferenceSpec; from: string; ids: string[] }[]

/** Where documents live: a collection, or a global by its slug. */
type Place = { collection: string; global?: boolean }

const placeKey = (place: Place): string =>
	`${place.global ? 'global' : 'collection'}:${place.collection}`

const globalConfig = (req: PayloadRequest, slug: string) =>
	req.payload.config.globals.find((global) => global.slug === slug)

const hasDrafts = (req: PayloadRequest, place: Place): boolean =>
	Boolean(
		place.global
			? globalConfig(req, place.collection)?.versions?.drafts
			: req.payload.collections[place.collection as CollectionSlug]?.config.versions?.drafts
	)

export const collectionLabel = (req: PayloadRequest, place: Place): string => {
	if (place.global) {
		const config = globalConfig(req, place.collection)
		return config?.label ? getTranslation(config.label, req.i18n) : place.collection
	}
	const config = req.payload.collections[place.collection as CollectionSlug]?.config
	return config ? getTranslation(config.labels.plural, req.i18n) : place.collection
}

const pointsAt = (ref: ReferenceSpec, target: string, id: number | string): Where =>
	ref.polymorphic
		? {
				and: [
					{ [`${ref.path}.value`]: { equals: id } },
					{ [`${ref.path}.relationTo`]: { equals: target } },
				],
			}
		: { [ref.path]: { in: [id] } }

/** The block type at every blocks field passed so far on the way down a value, by its path. */
type Way = Record<string, string>

/** A pointer at document `id` of `target`, through a field `ref` describes. */
type Pointer = { ref: ReferenceSpec; target: string; id: string; way?: Way }

/** The path of the field whose rows are being walked, while `rest` of `ref.path` is left. */
const rowsAt = (ref: ReferenceSpec, rest: string[]): string => {
	const segments = ref.path.split('.')
	return segments.slice(0, segments.length - rest.length).join('.')
}

/**
 * The way down through one row of the field at `at`: with the row's block type added when
 * the reference runs through that blocks field, or null when no way of it goes through
 * this row's block. Rows of any other field keep the way as it is.
 */
const throughRow = (
	{ ref, way = {} }: { ref: ReferenceSpec; way?: Way },
	at: string,
	row: unknown
): Way | null => {
	const ways = (ref.blocks ?? []).filter((each) =>
		Object.entries(way).every(([path, slug]) => each[path] === slug)
	)
	if (!ways.some((each) => at in each)) return way
	const type = (row as { blockType?: unknown } | null)?.blockType
	return typeof type === 'string' && ways.some((each) => each[at] === type)
		? { ...way, [at]: type }
		: null
}

/** Whether `item` is that pointer, in the shape the field stores. */
const isPointer = (item: unknown, { ref, target, id }: Pointer): boolean => {
	if (ref.polymorphic) {
		const pointer = item as { relationTo?: unknown; value?: unknown } | null
		return pointer?.relationTo === target && relationId(pointer.value) === id
	}
	return item !== null && item !== undefined && relationId(item) === id
}

/** Whether the value at `path` below `value` holds the pointer; arrays are rows or a list. */
const holds = (value: unknown, path: string[], pointer: Pointer): boolean => {
	if (Array.isArray(value)) {
		if (path.length === 0) return value.some((item) => isPointer(item, pointer))
		const at = rowsAt(pointer.ref, path)
		return value.some((row) => {
			const way = throughRow(pointer, at, row)
			return way !== null && holds(row, path, { ...pointer, way })
		})
	}
	if (path.length === 0) return isPointer(value, pointer)
	if (value === null || typeof value !== 'object') return false
	const [head, ...rest] = path as [string, ...string[]]
	return holds((value as Record<string, unknown>)[head], rest, pointer)
}

/**
 * Documents of `ref.collection` whose field points at `id`, in every locale the field has,
 * trash included, in the latest draft or the published state: a restored or published
 * document must not come back pointing at a record that is gone. A global is its one
 * document, under its slug as id.
 */
const findPointing = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	ref: ReferenceSpec
	target: string
	id: number | string
	extra?: Where[]
	limit?: number
	/** Shared by one preview: what a read of whole collections found for the group's documents. */
	scan?: Scan
	/** Filled with the documents found in their published state, as `placeKey|id`. */
	published?: Set<string>
}): Promise<Row[]> => {
	const { req, ctx, ref, target, id, extra = [], limit = REPOINT_LIMIT + 1 } = args
	// Each locale on its own, without falling back to another: a value one locale lacks stays
	// lacking. Without localization, or for a value shared by every locale, the default one.
	const locales = ref.localized && ctx.localeCodes ? ctx.localeCodes : [ctx.defaultLocale]
	// A query with `draft` sees the latest version only; a published state that still points
	// here behind a newer draft is found without it. The main row of a document never
	// published holds its first draft, which nobody sees and no write reaches.
	const states = hasDrafts(req, ref) ? [true, false] : [false]
	if (ref.global) {
		// Whether the global is published, read below Payload's hooks: they fill a missing status
		// with `draft`, and a global saved before drafts were turned on has none.
		const main =
			states.length > 1
				? ((await req.payload.db.findGlobal({
						slug: ref.collection as GlobalSlug,
						req: localRequest(req),
					})) as Row | null)
				: null
		const live = states.length === 1 || (main !== null && main._status !== 'draft')
		let pointing: Row | null = null
		for (const locale of locales) {
			for (const draft of states) {
				const doc = (await req.payload.findGlobal({
					slug: ref.collection as GlobalSlug,
					depth: 0,
					draft,
					overrideAccess: true,
					showHiddenFields: true,
					...(locale ? { locale, fallbackLocale: false as const } : {}),
					req: localRequest(req),
				})) as Record<string, unknown>
				if (!holds(doc, ref.path.split('.'), { ref, target, id: String(id) })) continue
				pointing ??= { ...doc, id: ref.collection }
				if (!draft && live) args.published?.add(`${placeKey(ref)}|${ref.collection}`)
			}
		}
		return pointing ? [pointing] : []
	}
	const { config } = req.payload
	const fields =
		req.payload.collections[ref.collection as CollectionSlug]?.config.flattenedFields ?? []
	// The SQL adapters cannot follow some paths at all (`pathQueryable`): such a collection is
	// read whole. A path through blocks is answered by the first block that has its next field:
	// MongoDB casts the value by that block's field, the SQL adapters query only its table, and
	// a path that block cannot finish is refused. Such a path is asked by block type. What
	// either finds is checked here, as is anything found through blocks.
	const sql = req.payload.db.name !== 'mongoose'
	const how =
		sql && !pathQueryable(config, fields, ref)
			? 'read'
			: ref.blocks && pathIsAmbiguous(config, fields, ref.path)
				? 'blockType'
				: 'path'
	const check = how !== 'path' || Boolean(ref.blocks)
	const segments = ref.path.split('.')
	// MongoDB keeps a polymorphic value per locale under the locale, and Payload adds no locale
	// to a path that goes on to `value` or `relationTo`: the query names it itself.
	const perLocale =
		!sql && ref.polymorphic && ref.localized ? localizedSegment(config, fields, ref) : null
	const queried = (locale: string | null) =>
		perLocale === null || !locale
			? ref
			: {
					...ref,
					path: [
						...segments.slice(0, perLocale + 1),
						locale,
						...segments.slice(perLocale + 1),
					].join('.'),
				}
	const byId = new Map<string, Row>()
	for (const locale of locales) {
		for (const draft of states) {
			const read = {
				collection: ref.collection as CollectionSlug,
				depth: 0,
				overrideAccess: true,
				showHiddenFields: true,
				draft,
				trash: true,
				...(locale ? { locale, fallbackLocale: false as const } : {}),
				req: localRequest(req),
			}
			const state = !draft && states.length > 1 ? [PUBLISHED] : []
			let docs: Row[]
			if (how === 'read') {
				const scan = args.scan ?? { ids: [String(id)], found: new Map<string, Row[]>() }
				const key = JSON.stringify([ref, locale, draft])
				if (!scan.found.has(key)) {
					const kept: Row[] = []
					// By id, as the scan walks a collection: pages by `createdAt` skip documents that share it.
					let last: number | string | null = null
					for (;;) {
						const result = await req.payload.find({
							...read,
							where: {
								and: [
									...extra,
									...state,
									...(last === null ? [] : [{ id: { greater_than: last } }]),
								],
							},
							sort: 'id',
							limit: SCAN_PAGE,
							pagination: false,
						})
						const page = result.docs as Row[]
						for (const doc of page) {
							if (scan.ids.some((one) => holds(doc, segments, { ref, target, id: one }))) {
								kept.push(doc)
							}
						}
						if (page.length < SCAN_PAGE) break
						last = (page[page.length - 1] as Row).id
					}
					scan.found.set(key, kept)
				}
				docs = scan.found.get(key) ?? []
			} else {
				const outer = Object.keys(ref.blocks?.[0] ?? {})[0]
				const byBlock: Where = {
					or: [...new Set((ref.blocks ?? []).map((way) => way[outer as string]))].map((slug) => ({
						[`${outer}.blockType`]: { equals: slug },
					})),
				}
				const result = await req.payload.find({
					...read,
					where: {
						and: [
							how === 'blockType' ? byBlock : pointsAt(queried(locale), target, id),
							...extra,
							...state,
						],
					},
					...(how === 'blockType' ? {} : { limit }),
					pagination: false,
				})
				docs = result.docs as Row[]
			}
			for (const doc of docs) {
				if (check && !holds(doc, segments, { ref, target, id: String(id) })) continue
				if (!draft) args.published?.add(`${placeKey(ref)}|${doc.id}`)
				if (!byId.has(String(doc.id))) byId.set(String(doc.id), doc)
			}
		}
	}
	return [...byId.values()]
}

/**
 * Titles as the reviewer may read them; a document they may not read shows as its id. A
 * global shows as its label, which the config holds, not the data.
 */
export const readableRefs = async (
	req: PayloadRequest,
	place: Place,
	ids: string[]
): Promise<RepointDocRef[]> => {
	if (place.global) return ids.map((id) => ({ id, title: collectionLabel(req, place) }))
	const slug = place.collection
	// A merge record may name a collection the app has since dropped.
	if (!req.payload.collections[slug as CollectionSlug]) return ids.map((id) => ({ id, title: id }))
	const result = await req.payload.find({
		collection: slug as CollectionSlug,
		where: { id: { in: ids } },
		depth: 0,
		limit: ids.length,
		pagination: false,
		overrideAccess: false,
		user: req.user,
		disableErrors: true,
		draft: hasDrafts(req, place),
		trash: true,
		req,
	})
	const titles = new Map(
		(result.docs as Row[]).map((doc) => [String(doc.id), docTitle(req, slug, doc)])
	)
	return ids.map((id) => ({ id, title: titles.get(id) ?? id }))
}

const clashKey = (doc: Row, others: string[]): string | null => {
	// As a query compares them: relationships by id, the rest as they are.
	const values = others.map((path) => {
		const value = readPath(doc, path)
		return value !== null && typeof value === 'object' ? relationId(value) : value
	})
	if (values.some((value) => value === undefined || value === null || value === '')) return null
	return JSON.stringify(values)
}

/** Of `ids`, the published documents of `place` that have a newer draft on top. */
const pendingDrafts = async (
	req: PayloadRequest,
	place: Place,
	ids: Set<string>
): Promise<string[]> => {
	if (place.global) {
		// Read below Payload's hooks: they fill a missing status with `draft`, and a global saved
		// before drafts were turned on has none, though it is the published state.
		const slug = place.collection as GlobalSlug
		const {
			docs: [latest],
		} = await req.payload.db.findGlobalVersions<Row>({
			global: slug,
			where: { latest: { equals: true } },
			sort: '-updatedAt',
			limit: 1,
			pagination: false,
			req: localRequest(req),
		})
		if (latest?.version._status !== 'draft') return []
		const main = (await req.payload.db.findGlobal({ slug, req: localRequest(req) })) as Row | null
		return main && main._status !== 'draft' ? [place.collection] : []
	}
	const slug = place.collection as CollectionSlug
	const latest = await req.payload.find({
		collection: slug,
		where: { id: { in: [...ids] } },
		depth: 0,
		limit: ids.size,
		pagination: false,
		overrideAccess: true,
		draft: true,
		trash: true,
		req: localRequest(req),
	})
	const drafts = (latest.docs as Row[]).filter((doc) => doc._status === 'draft')
	if (drafts.length === 0) return []
	const published = await req.payload.find({
		collection: slug,
		where: {
			and: [{ id: { in: drafts.map((doc) => doc.id) } }, PUBLISHED],
		},
		depth: 0,
		limit: drafts.length,
		pagination: false,
		overrideAccess: true,
		draft: false,
		trash: true,
		req: localRequest(req),
	})
	return (published.docs as Row[]).map((doc) => String(doc.id))
}

/**
 * What a merge of the `absorbed` documents into `survivor` would move, and what stands in
 * its way: documents a unique field or index would not allow side by side once they all
 * point at the survivor (its own ones, or those of two absorbed documents), a document with
 * unpublished changes that the write would publish, or more documents than a merge should
 * touch.
 */
export const previewRepoint = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	survivorId: number | string
	absorbedIds: (number | string)[]
}): Promise<{ preview: RepointPreview; found: RepointFound; published: Set<string> }> => {
	const { req, ctx, col, survivorId, absorbedIds } = args
	const target = col.slug as string
	const group = [String(survivorId), ...absorbedIds.map(String)]
	const preview: RepointPreview = {
		entries: [],
		conflicts: [],
		blockers: [],
		linked: Object.fromEntries(group.map((id) => [id, []])),
	}
	const found: RepointFound = []
	const excluded = new Set(group)
	const scan: Scan = { ids: group, found: new Map() }
	const published = new Set<string>()

	// Fields of one name in several blocks may be several references; each field is listed
	// once, a document in it once.
	const linkedIds = new Map<string, { ref: ReferenceSpec; id: string; ids: Set<string> }>()
	const movingIds = new Map<string, { ref: ReferenceSpec; from: string; ids: Set<string> }>()
	const add = <T extends { ids: Set<string> }>(map: Map<string, T>, key: string, entry: T) => {
		const known = map.get(key) ?? entry
		for (const id of entry.ids) known.ids.add(id)
		map.set(key, known)
	}
	for (const ref of col.references) {
		const label = collectionLabel(req, ref)
		const moving: { doc: Row; from: string }[] = []
		const pending: { from: string; ids: string[] }[] = []
		const clashing = new Set<string>()
		for (const id of group) {
			// What points at the survivor stays as it is, whatever state it is in.
			const own = id === group[0]
			const docs = (
				await findPointing({
					req,
					ctx,
					ref,
					target,
					id,
					scan,
					published: own ? undefined : published,
				})
			).filter((doc) => ref.global || ref.collection !== target || !excluded.has(String(doc.id)))
			if (docs.length === 0) continue
			const ids = docs.map((doc) => String(doc.id))
			add(linkedIds, `${id}|${placeKey(ref)}|${ref.path}`, { ref, id, ids: new Set(ids) })
			if (id === group[0] || ref.policy !== 'repoint') continue
			found.push({ ref, from: id, ids })
			moving.push(...docs.map((doc) => ({ doc, from: id })))
			pending.push({ from: id, ids })
		}

		for (const others of ref.uniquePer) {
			const byKey = new Map<string, { doc: Row; from: string }[]>()
			for (const entry of moving) {
				const key = clashKey(entry.doc, others)
				if (key === null) continue
				byKey.set(key, [...(byKey.get(key) ?? []), entry])
			}
			for (const [key, entries] of byKey) {
				const values = JSON.parse(key) as unknown[]
				const [held] = await findPointing({
					req,
					ctx,
					ref,
					target,
					id: survivorId,
					extra: others.map((path, i) => ({ [path]: { equals: values[i] } })),
					limit: 1,
				})
				const owners = [
					...(held ? [{ doc: held, from: group[0] as string }] : []),
					...entries,
				].filter((entry, index, all) => all.findIndex((o) => o.doc.id === entry.doc.id) === index)
				if (owners.length < 2) continue
				for (const entry of entries) clashing.add(String(entry.doc.id))
				const refs = await readableRefs(
					req,
					ref,
					owners.map((owner) => String(owner.doc.id))
				)
				preview.conflicts.push({
					collection: ref.collection,
					collectionLabel: label,
					fields: [ref.path, ...others],
					docs: owners.map((owner, index) => ({
						owner: owner.from,
						doc: refs[index] as RepointDocRef,
					})),
				})
			}
		}

		for (const { from, ids } of pending) {
			const free = ids.filter((id) => !clashing.has(id))
			if (free.length > 0) {
				add(movingIds, `${from}|${placeKey(ref)}|${ref.path}`, { ref, from, ids: new Set(free) })
			}
		}
	}

	const linkedFrom = async (ref: ReferenceSpec, ids: Set<string>): Promise<LinkedFrom> => ({
		collection: ref.collection,
		...(ref.global ? { global: true } : {}),
		collectionLabel: collectionLabel(req, ref),
		path: ref.path,
		label: toWords(ref.path.split('.').pop() ?? ref.path),
		total: ids.size,
		docs: await readableRefs(req, ref, [...ids].slice(0, LISTED)),
	})
	for (const { ref, id, ids } of linkedIds.values()) {
		preview.linked[id]?.push(await linkedFrom(ref, ids))
	}
	for (const { ref, from, ids } of movingIds.values()) {
		preview.entries.push({ ...(await linkedFrom(ref, ids)), from })
	}
	const total = new Set(found.flatMap(({ ref, ids }) => ids.map((id) => `${placeKey(ref)}|${id}`)))
		.size

	// A published state that points here, with a newer draft on top: the move writes the draft,
	// and the published state would keep pointing at a document gone. One only a draft points
	// from is moved in its draft, which is all it holds.
	const byPlace = new Map<string, { place: Place; ids: Set<string> }>()
	for (const { ref, ids } of found) {
		const entry = byPlace.get(placeKey(ref)) ?? { place: ref, ids: new Set<string>() }
		for (const id of ids) if (published.has(`${placeKey(ref)}|${id}`)) entry.ids.add(id)
		byPlace.set(placeKey(ref), entry)
	}
	for (const { place, ids } of byPlace.values()) {
		if (!hasDrafts(req, place) || ids.size === 0) continue
		for (const doc of await readableRefs(req, place, await pendingDrafts(req, place, ids))) {
			preview.blockers.push({
				collection: place.collection,
				...(place.global ? { global: true } : {}),
				collectionLabel: collectionLabel(req, place),
				reason: 'pendingDraft',
				doc,
			})
		}
	}

	if (total > REPOINT_LIMIT) {
		preview.blockers.push({ reason: 'tooMany', count: total })
	}
	return { preview, found, published }
}

/** The first reason a preview stops a merge, as the apply reports it. */
export const repointRefusal = (preview: RepointPreview): Error | null => {
	const [conflict] = preview.conflicts
	if (conflict) {
		const titles = conflict.docs.map(({ doc }) => `"${doc.title}"`).join(', ')
		return new APIError(
			`Moving the references would make ${conflict.collectionLabel} ${titles} collide on ${conflict.fields.join(' + ')}. Resolve it first.`,
			409,
			undefined,
			true
		)
	}
	const [blocker] = preview.blockers
	if (blocker?.reason === 'pendingDraft') {
		const what = blocker.global
			? blocker.collectionLabel
			: `${blocker.collectionLabel} "${blocker.doc.title}"`
		return new APIError(
			`${what} has unpublished changes. Publish or discard them first.`,
			409,
			undefined,
			true
		)
	}
	if (blocker?.reason === 'tooMany') {
		return new APIError(
			`${blocker.count} documents point at the absorbed ones, more than a merge moves (${REPOINT_LIMIT}).`,
			409,
			undefined,
			true
		)
	}
	return null
}

/** One move: which reference, from which document to which, and the way down so far. */
type Move = { ref: ReferenceSpec; target: string; from: string; to: number | string; way?: Way }

/**
 * The value at `path` below `value` with every pointer at `from` turned to `to`. Arrays on
 * the way are rows; an array at the end is a `hasMany` value, where the survivor appearing
 * twice after the move is kept once.
 */
const rewrite = (value: unknown, path: string[], move: Move): [unknown, boolean] => {
	const { ref, target, from, to } = move
	const swap = (item: unknown): unknown => {
		if (!isPointer(item, { ref, target, id: from })) return item
		return ref.polymorphic ? { relationTo: target, value: to } : to
	}
	const key = (item: unknown): string =>
		ref.polymorphic
			? `${(item as { relationTo?: unknown }).relationTo}:${relationId((item as { value?: unknown }).value)}`
			: relationId(item)

	if (path.length === 0) {
		if (Array.isArray(value)) {
			const swapped = value.map(swap)
			const seen = new Set<string>()
			const next = swapped.filter((item) => {
				const id = key(item)
				if (seen.has(id)) return false
				seen.add(id)
				return true
			})
			const changed = next.length !== value.length || next.some((item, i) => item !== value[i])
			return [next, changed]
		}
		const next = swap(value)
		return [next, next !== value]
	}
	if (Array.isArray(value)) {
		const at = rowsAt(ref, path)
		let changed = false
		const rows = value.map((row) => {
			const way = throughRow(move, at, row)
			if (way === null) return row
			const [next, rowChanged] = rewrite(row, path, { ...move, way })
			changed ||= rowChanged
			return next
		})
		return [rows, changed]
	}
	if (value === null || typeof value !== 'object') return [value, false]
	const [head, ...rest] = path as [string, ...string[]]
	const [child, changed] = rewrite((value as Record<string, unknown>)[head], rest, move)
	return changed ? [{ ...(value as Record<string, unknown>), [head]: child }, true] : [value, false]
}

/**
 * Point every document the preview found at the survivor. Runs inside the merge's
 * transaction, through Payload so the referencing collections' and globals' own hooks see
 * the change, with access overridden: the merge was allowed, and moving what hangs off it
 * is part of it. A localized field is written in every locale; a document keeps its draft
 * state.
 */
export const applyRepoint = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	found: RepointFound
	/** The documents the preview found in their published state, as `placeKey|id`. */
	published: Set<string>
	survivorId: number | string
}): Promise<Repointed> => {
	const { req, ctx, col, found, published, survivorId } = args
	const target = col.slug as string
	const moved = new Set<string>()
	const byPlace = new Map<string, RepointFound>()
	for (const entry of found) {
		const list = byPlace.get(placeKey(entry.ref)) ?? []
		list.push(entry)
		byPlace.set(placeKey(entry.ref), list)
	}

	for (const entries of byPlace.values()) {
		const place = (entries[0] as RepointFound[number]).ref
		const slug = place.collection
		const drafts = hasDrafts(req, place)
		const ids = new Set(entries.flatMap((entry) => entry.ids))
		for (const id of ids) {
			const moves = entries.filter((entry) => entry.ids.includes(id))
			// As in `findPointing`: each locale on its own, the default one for what all share.
			const locales =
				moves.some(({ ref }) => ref.localized) && ctx.localeCodes
					? ctx.localeCodes
					: [ctx.defaultLocale]
			for (const [index, locale] of locales.entries()) {
				// A field that is not localized is shared by every locale: write it once.
				const now = index === 0 ? moves : moves.filter(({ ref }) => ref.localized)
				const read = {
					depth: 0,
					draft: drafts,
					overrideAccess: true,
					showHiddenFields: true,
					...(locale ? { locale, fallbackLocale: false as const } : {}),
					req: localRequest(req),
				}
				const doc = (
					place.global
						? await req.payload.findGlobal({ slug: slug as GlobalSlug, ...read })
						: await req.payload.findByID({
								collection: slug as CollectionSlug,
								id,
								trash: true,
								...read,
							})
				) as Row
				const patch: Record<string, unknown> = {}
				for (const { ref, from } of now) {
					const [head, ...rest] = ref.path.split('.') as [string, ...string[]]
					const [next, changed] = rewrite(patch[head] ?? doc[head], rest, {
						ref,
						target,
						from,
						to: survivorId,
					})
					if (changed) {
						patch[head] = next
						moved.add(`${placeKey(ref)}|${ref.path}|${from}|${id}`)
					}
				}
				if (Object.keys(patch).length === 0) continue
				// Found in its published state with no newer draft (one with a newer draft stops the
				// merge): a document saved before drafts were turned on, which Payload reads as a draft.
				// Written as the published one it is, or the main row the site reads keeps the pointer.
				const live = drafts && doc._status === 'draft' && published.has(`${placeKey(place)}|${id}`)
				const write = {
					data: (live ? { ...patch, _status: 'published' } : patch) as never,
					depth: 0,
					draft: drafts && doc._status === 'draft' && !live,
					overrideAccess: true,
					overrideLock: true,
					context: dedupeContext(),
					// A global's update reads what it holds with the fallback locale and writes it
					// back, so a locale without a value would get another's.
					...(locale ? { locale, fallbackLocale: false as const } : {}),
					req: localRequest(req),
				}
				try {
					if (place.global) {
						await req.payload.updateGlobal({ slug: slug as GlobalSlug, ...write })
					} else {
						await req.payload.update({
							collection: slug as CollectionSlug,
							id,
							trash: true,
							...write,
						})
					}
				} catch (error) {
					// A document saved before a rule it now breaks: the move cannot write it.
					if (!(error instanceof ValidationError)) throw error
					throw new APIError(
						`${collectionLabel(req, place)} ${id} cannot be saved as it is, so its reference cannot move: ${error.message} Fix it first.`,
						409,
						undefined,
						true
					)
				}
			}
		}
	}
	// Only the documents a write changed: one found by a query but holding nothing to move
	// is not listed as moved. A field of one name in several blocks may be several references;
	// it is listed once per merged-in document.
	const listed = new Map<string, Repointed[number]>()
	for (const { ref, from, ids } of found) {
		const written = ids.filter((id) => moved.has(`${placeKey(ref)}|${ref.path}|${from}|${id}`))
		if (written.length === 0) continue
		const key = `${placeKey(ref)}|${ref.path}|${from}`
		const entry = listed.get(key) ?? {
			collection: ref.collection,
			...(ref.global ? { global: true } : {}),
			path: ref.path,
			from,
			ids: [],
		}
		entry.ids = [...new Set([...entry.ids, ...written])]
		listed.set(key, entry)
	}
	return [...listed.values()]
}
