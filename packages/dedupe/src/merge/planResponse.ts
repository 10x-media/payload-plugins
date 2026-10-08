import {
	APIError,
	type CollectionSlug,
	type FlattenedField,
	getFieldByPath,
	type PayloadRequest,
	type SanitizedConfig,
} from 'payload'
import { PAIRS_SLUG } from '../collections/slugs'
import { pairKeyFor } from '../match/keys'
import type { CollectionContext, PluginContext } from '../plugin/context'
import { fullLabel } from '../schema/deriveSpec'
import type { MergeChoice, MergeDecision } from '../schema/types'
import { mergeableSpec, withoutUnreadable } from './access'
import {
	accessRefusal,
	deletionRefusal,
	lockRefusal,
	missingRefusal,
	removalRefusal,
} from './apply'
import {
	fieldsWithin,
	inLocale,
	isEmpty,
	listOf,
	perLocale,
	relationId,
	rowFields,
	rowsById,
} from './compare'
import {
	allReadable,
	bySimilarity,
	checkGroup,
	describeUsers,
	docTitle,
	type LoadedDoc,
	loadDocs,
	loadMergeGroup,
	publishesDrafts,
	READ_REFUSED,
	readableTitle,
	survivorHasDraft,
	validatesWrite,
} from './load'
import { planMerge } from './plan'
import { richTextHTML } from './richText'
import { releaseUnique, type UniqueRelease } from './unique'
import { resolveWriteLocale } from './writeLocale'

export type DocRef = {
	id: string
	title: string
	createdAt: string | null
	updatedAt: string | null
	/** `draft` or `published` on a collection with drafts. */
	status: string | null
}

export type DecisionView = MergeDecision & {
	label: string
	/** Titles of related documents, by id, for relationship and upload values. */
	relationLabels?: Record<string, string>
	/** A rich text value as the version view draws it, as HTML by document id. */
	html?: Record<string, string>
}

export type PlanResponse = {
	/** The survivor's id; the screen drops an answer for a survivor it has since moved away from. */
	survivor: string
	/** Every document of the merge, the survivor first. */
	docs: DocRef[]
	decisions: DecisionView[]
	readyToApply: boolean
	/**
	 * `off` when the database opens no transaction, so a failure halfway leaves some steps
	 * done; `refused` when it opens none and `requireTransactions` forbids merging without.
	 */
	transactions: 'off' | 'on' | 'refused'
	/** Documents of the group were marked not duplicates: the latest such decision. */
	dismissed: { at: string | null; by: string | null } | null
	/** Pairs of the group marked not duplicates while the group as a whole is not. */
	markedApart: { docs: [string, string]; at: string | null; by: string | null }[]
	/**
	 * What each absorbed document gives up on its way to the trash, by id; empty when the
	 * collection deletes them anyway.
	 */
	release: Record<string, UniqueRelease>
	/** Decision keys whose result loses pointers at documents of the merge itself. */
	cleared: string[]
	/** The survivor has an unpublished draft, which merging the published state would publish. */
	survivorDraft: boolean
	/** Why the reviewer's access would refuse the apply, or null. */
	refusal: string | null
	/** What else stops the apply for now, said as it is: an open lock, a value a language needs. */
	blocked: string | null
	/** Keys whose required value comes from the most similar document of the merge. */
	filled: string[]
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const docRef = async (
	req: PayloadRequest,
	col: CollectionContext,
	doc: LoadedDoc
): Promise<DocRef> => ({
	id: String(doc.id),
	title: await readableTitle(req, col, doc),
	createdAt: text(doc.createdAt),
	updatedAt: text(doc.updatedAt),
	status: text(doc._status),
})

/** Adds every document `value` points at, to one collection or, polymorphic, to several. */
const pointedAt = (
	value: unknown,
	relationTo: string | string[],
	add: (slug: string, id: string) => void
): void => {
	for (const item of listOf(value)) {
		if (isEmpty(item)) continue
		if (typeof relationTo === 'string') {
			add(relationTo, relationId(item))
			continue
		}
		const pointer = item as { relationTo?: unknown; value?: unknown }
		if (typeof pointer.relationTo === 'string' && !isEmpty(pointer.value)) {
			add(pointer.relationTo, relationId(pointer.value))
		}
	}
}

/** Every related document a value holds, down through groups, rows and blocks of rows. */
const relatedIn = (
	field: FlattenedField,
	value: unknown,
	into: { config: SanitizedConfig; add: (slug: string, id: string) => void }
): void => {
	const { config, add } = into
	const rows = (Array.isArray(value) ? value : []).filter(
		(row): row is Record<string, unknown> => row !== null && typeof row === 'object'
	)
	switch (field.type) {
		case 'relationship':
		case 'upload':
			pointedAt(value, field.relationTo, add)
			return
		case 'group':
		case 'tab':
		case 'array':
		case 'blocks':
			for (const row of field.type === 'group' || field.type === 'tab' ? [value] : rows) {
				if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
				const data = row as Record<string, unknown>
				for (const sub of rowFields(field, data, config.blocks))
					relatedIn(sub, data[sub.name], into)
			}
			return
		default:
			return
	}
}

/**
 * Titles for the related documents a decision shows, so a reviewer sees "Acme GmbH"
 * rather than an id, polymorphic ones included.
 */
const resolveRelationLabels = async (
	req: PayloadRequest,
	col: CollectionContext,
	decisions: MergeDecision[]
): Promise<{
	labels: Map<string, Record<string, string>>
	/** The collections the rows of each array or blocks decision point into, by its key. */
	inRows: Map<string, Set<string>>
}> => {
	const idsByCollection = new Map<string, Set<string>>()
	const add = (slug: string, id: string) => {
		const ids = idsByCollection.get(slug) ?? new Set<string>()
		ids.add(id)
		idsByCollection.set(slug, ids)
	}
	const inRows = new Map<string, Set<string>>()
	for (const decision of decisions) {
		if (decision.type === 'array' || decision.type === 'blocks') {
			const field = getFieldByPath({ fields: col.config.flattenedFields, path: decision.path })
			if (!field) continue
			const slugs = new Set<string>()
			for (const { value } of decision.values) {
				relatedIn(field.field, value, {
					config: req.payload.config,
					add: (slug, id) => {
						slugs.add(slug)
						add(slug, id)
					},
				})
			}
			inRows.set(decision.key, slugs)
			continue
		}
		if (!decision.relationTo) continue
		for (const { value } of decision.values) pointedAt(value, decision.relationTo, add)
	}
	const labels = new Map<string, Record<string, string>>()
	for (const [slug, ids] of idsByCollection) {
		if (ids.size === 0 || !req.payload.collections[slug as CollectionSlug]) continue
		const result = await req.payload.find({
			collection: slug as CollectionSlug,
			where: { id: { in: [...ids].slice(0, 100) } },
			depth: 0,
			limit: 100,
			pagination: false,
			// A related document the reviewer may not read stays an id, as in the admin's own fields.
			overrideAccess: false,
			user: req.user,
			disableErrors: true,
			req,
		})
		const map: Record<string, string> = {}
		for (const doc of result.docs as LoadedDoc[]) {
			map[String(doc.id)] = docTitle(req, slug, doc)
		}
		labels.set(slug, map)
	}
	return { labels, inRows }
}

/**
 * Decisions as the admin shows them: each field's label in the reader's language, the
 * titles of related documents, no values the reader may not read, and, unless `showHidden`,
 * no values of a field the admin hides.
 */
const describeDecisions = async (args: {
	req: PayloadRequest
	col: CollectionContext
	decisions: MergeDecision[]
	/** Each document of the merge by id, for the fields' own read access. */
	docs: Record<string, LoadedDoc | undefined>
	/** The reader's locale, taken before any read that names its own. */
	locale: string | null | undefined
	showHidden?: boolean
}): Promise<DecisionView[]> => {
	const { req, col, docs, showHidden = false } = args
	const readable = await withoutUnreadable({ req, col, decisions: args.decisions, docs })
	// A list whose rows hold values per locale is shown in the reader's locale.
	const { localization, blocks: known } = req.payload.config
	const locale =
		args.locale && args.locale !== 'all'
			? args.locale
			: localization
				? localization.defaultLocale
				: null
	const decisions = readable.map((decision) => {
		if (!locale || decision.locale || (decision.type !== 'array' && decision.type !== 'blocks')) {
			return decision
		}
		const field = getFieldByPath({ fields: col.config.flattenedFields, path: decision.path })?.field
		if (!field || !fieldsWithin(field, known).some((sub) => perLocale(sub, false))) return decision
		const narrow = (value: unknown) => inLocale(value, field, { locale, known })
		return {
			...decision,
			values: decision.values.map((entry) => ({ ...entry, value: narrow(entry.value) })),
			proposed: narrow(decision.proposed),
		}
	})
	const { labels: relationLabels, inRows } = await resolveRelationLabels(req, col, decisions)
	return Promise.all(
		decisions.map(async (decision) => {
			const label = fullLabel(decision.path, col, req.i18n)
			// A polymorphic value, and any value inside rows, is keyed as `collection:id`.
			const slugs = inRows.get(decision.key)
			const related = slugs
				? Object.fromEntries(
						[...slugs].flatMap((slug) =>
							Object.entries(relationLabels.get(slug) ?? {}).map(([id, title]) => [
								`${slug}:${id}`,
								title,
							])
						)
					)
				: typeof decision.relationTo === 'string'
					? relationLabels.get(decision.relationTo)
					: Array.isArray(decision.relationTo)
						? Object.fromEntries(
								decision.relationTo.flatMap((slug) =>
									Object.entries(relationLabels.get(slug) ?? {}).map(([id, title]) => [
										`${slug}:${id}`,
										title,
									])
								)
							)
						: undefined
			// A field the admin hides is merged all the same, but its values stay on the server.
			const hidden = decision.hidden && !showHidden
			const values = hidden
				? {
						values: decision.values.map(({ doc }) => ({ doc, value: undefined })),
						proposed: undefined,
					}
				: {}
			const html =
				decision.type === 'richText' && !hidden
					? await richTextHTML(req, decision.values)
					: undefined
			return {
				...decision,
				...values,
				label,
				...(related ? { relationLabels: related } : {}),
				...(html ? { html } : {}),
			}
		})
	)
}

/** The plan as the merge screen renders it: labels resolved, related titles attached. */
export const buildPlanResponse = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	survivorId: number | string
	absorbedIds: (number | string)[]
	choices: Record<string, MergeChoice>
}): Promise<PlanResponse> => {
	const { req, ctx, col, survivorId, absorbedIds, choices } = args
	const { locale } = req
	checkGroup(args)
	// The plan carries every document whole, so it is the collection's read access that
	// decides who gets it; the plugin's own gate only opens the screen.
	if (!(await allReadable({ req, col, ids: [survivorId, ...absorbedIds] }))) {
		throw new APIError(READ_REFUSED, 403, undefined, true)
	}
	const { survivor, absorbed } = await loadMergeGroup({ req, ctx, col, survivorId, absorbedIds })
	const similar = await bySimilarity({
		req,
		col,
		survivorId: survivor.id,
		absorbedIds: absorbed.map((doc) => doc.id),
	})
	const plan = planMerge({
		survivor,
		absorbed,
		fields: await mergeableSpec({ req, col, docs: [survivor, ...absorbed] }),
		locales: ctx.localeCodes,
		choices,
		collection: col.slug,
		schema: { fields: col.config.flattenedFields, blocks: req.payload.config.blocks },
		writeLocale: await resolveWriteLocale({ req, ctx, col, survivor }),
		similar,
		validates: validatesWrite(col),
		publishesDrafts: publishesDrafts(col),
	})

	const decisions = await describeDecisions({
		req,
		col,
		decisions: plan.decisions,
		docs: Object.fromEntries([survivor, ...absorbed].map((doc) => [String(doc.id), doc])),
		locale,
	})

	const available = await transactionsOn(req)
	const transactions = available ? 'on' : ctx.options.requireTransactions ? 'refused' : 'off'
	const survivorDraft = await survivorHasDraft({ req, col, id: survivor.id })
	// What each merged-in document gives up, as the apply works it out in either mode; shown only
	// for the trash, as a document deleted gives up everything.
	const released: Record<string, UniqueRelease> = {}
	{
		const ids = [survivor.id, ...absorbed.map((doc) => doc.id)]
		const known = req.payload.config.blocks
		// The fields hidden from the API, read only where rows or a unique index hold them.
		const hiddenInRows = col.config.flattenedFields.some(
			(field) => !field.hidden && fieldsWithin(field, known).some((sub) => sub.hidden === true)
		)
		const hiddenOnPath = (path: string) => {
			const parts = path.split('.')
			return parts.some(
				(_, index) =>
					getFieldByPath({
						fields: col.config.flattenedFields,
						path: parts.slice(0, index + 1).join('.'),
					})?.field.hidden === true
			)
		}
		const hiddenInIndex = (col.config.sanitizedIndexes ?? []).some(
			(index) => index.unique && index.fields.some((entry) => hiddenOnPath(entry.path))
		)
		const full =
			hiddenInRows || hiddenInIndex
				? await loadDocs({ req, ctx, col, ids, showHiddenFields: true })
				: []
		const hidden = rowsById(full)
		const fullOf = new Map(full.map((one) => [String(one.id), one]))
		for (const doc of absorbed) {
			released[String(doc.id)] = (
				await releaseUnique({
					req,
					col,
					locales: ctx.localeCodes,
					survivor: fullOf.get(String(survivor.id)) ?? survivor,
					absorbed: fullOf.get(String(doc.id)) ?? doc,
					plan,
					hidden,
				})
			).release
		}
	}
	const release = col.options.absorbed === 'trash' ? released : {}
	// The documents were checked for reading above.
	const refusal =
		(await accessRefusal({ req, ctx, col, survivorId: survivor.id })) ??
		(await removalRefusal({
			req,
			col,
			absorbedIds: absorbed.map((doc) => doc.id),
			deleted: Object.entries(released)
				.filter(([, given]) => given.deletes.length > 0)
				.map(([id]) => id),
		}))
	// Not the reviewer's access: an editor holds a document open, or a language would be left
	// without a value Payload requires there.
	const blocked =
		(await lockRefusal({ req, col, docs: [survivor, ...absorbed] })) ??
		missingRefusal(req, col, plan.missing) ??
		(available
			? null
			: await deletionRefusal({
					req,
					col,
					absorbed,
					deletes: Object.fromEntries(
						Object.entries(released).map(([id, given]) => [id, given.deletes])
					),
				}))

	const ids = [survivor, ...absorbed].map((doc) => doc.id)
	const pairKeys = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => pairKeyFor(col.slug, a, b)))
	const { docs: marked } = await req.payload.db.find<{
		docA: string
		docB: string
		decidedAt: string | null
		decidedBy: string | null
	}>({
		collection: PAIRS_SLUG,
		where: { and: [{ pairKey: { in: pairKeys } }, { status: { equals: 'dismissed' } }] },
		sort: '-decidedAt',
		limit: pairKeys.length,
		pagination: false,
		req,
	})
	// Marked as a group once the marked pairs join every document, as the queue groups them;
	// otherwise it can still be marked.
	const root = new Map(ids.map((id) => [String(id), String(id)]))
	const find = (id: string): string => {
		const up = root.get(id) ?? id
		return up === id ? id : find(up)
	}
	for (const pair of marked) root.set(find(pair.docA), find(pair.docB))
	const joined = new Set(ids.map((id) => find(String(id)))).size === 1
	const decided = joined ? marked[0] : undefined
	const deciders = await describeUsers(
		req,
		marked.flatMap((pair) => (pair.decidedBy ? [pair.decidedBy] : []))
	)
	const decider = (ref: string | null) => (ref ? (deciders.get(ref) ?? ref) : null)

	return {
		survivor: String(survivor.id),
		docs: await Promise.all([survivor, ...absorbed].map((doc) => docRef(req, col, doc))),
		decisions,
		readyToApply:
			plan.readyToApply &&
			!survivorDraft &&
			refusal === null &&
			blocked === null &&
			transactions !== 'refused',
		transactions,
		dismissed: decided ? { at: decided.decidedAt, by: decider(decided.decidedBy) } : null,
		markedApart: joined
			? []
			: marked.map((pair) => ({
					docs: [pair.docA, pair.docB],
					at: pair.decidedAt,
					by: decider(pair.decidedBy),
				})),
		release,
		cleared: plan.cleared,
		survivorDraft,
		refusal,
		blocked,
		filled: plan.filled,
	}
}

/**
 * Whether the database opens a transaction, as `initTransaction` asks it: a MongoDB without a
 * replica set, or an adapter given `transactionOptions: false`, answers with none.
 */
const transactionsOn = async (req: PayloadRequest): Promise<boolean> => {
	const id = await req.payload.db.beginTransaction()
	if (!id) return false
	await req.payload.db.rollbackTransaction(id)
	return true
}
