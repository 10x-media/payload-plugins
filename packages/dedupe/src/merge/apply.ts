import { getTranslation } from '@payloadcms/translations'
import {
	APIError,
	type CollectionSlug,
	commitTransaction,
	type FlattenedBlock,
	getFieldByPath,
	initTransaction,
	killTransaction,
	type PayloadRequest,
} from 'payload'
import { toWords } from 'payload/shared'

import {
	type CollectionContext,
	dedupeContext,
	type PluginContext,
	userRef,
} from '../plugin/context'
import { emitEvent } from '../plugin/events'
import { checkDocument } from '../queue/live'
import { closePairsFor } from '../queue/pairs'
import { AUTH_FIELDS } from '../schema/deriveSpec'
import type { MergeChoice, MergePlan } from '../schema/types'
import { mergeableSpec } from './access'
import {
	fieldsWithin,
	freshWithin,
	heldIn,
	inLocale,
	mergeData,
	perLocale,
	readPath,
	rowsById,
	withHiddenRows,
	writePath,
} from './compare'
import {
	allReadable,
	bySimilarity,
	checkGroup,
	describeUsers,
	docAllowed,
	type LoadedDoc,
	loadDoc,
	loadDocs,
	loadMergeGroup,
	localRequest,
	publishesDrafts,
	READ_REFUSED,
	readableTitle,
	survivorHasDraft,
	validatesWrite,
} from './load'
import { planMerge } from './plan'
import { releaseUnique } from './unique'
import { resolveWriteLocale } from './writeLocale'

type ApplyMergeArgs = {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	survivorId: number | string
	absorbedIds: (number | string)[]
	choices: Record<string, MergeChoice>
	/**
	 * `updatedAt` of the documents as the reviewer saw them, by id; the apply refuses if one
	 * moved since.
	 */
	expected?: Record<string, string>
}

export type ApplyMergeResult = {
	survivorId: string
}

const forbidden = (message: string): Error => new APIError(message, 403, undefined, true)

/** Array and blocks values of a write, and groups holding them, with new ids on the rows from other documents. */
const withFreshRows = (args: {
	col: CollectionContext
	survivor: Record<string, unknown>
	data: Record<string, unknown>
	locale?: string
	blocks: FlattenedBlock[] | undefined
	hidden: ReadonlyMap<string, Record<string, unknown>>
}): void => {
	const { col, survivor, data, locale, blocks, hidden } = args
	for (const spec of col.spec) {
		if (spec.type !== 'array' && spec.type !== 'blocks' && spec.type !== 'group') continue
		const value = readPath(data, spec.path)
		if (value === undefined || value === null) continue
		const field = getFieldByPath({ fields: col.config.flattenedFields, path: spec.path })?.field
		if (!field) continue
		const current = readPath(survivor, spec.path)
		const own =
			spec.localized && locale && current && typeof current === 'object' && !Array.isArray(current)
				? (current as Record<string, unknown>)[locale]
				: current
		writePath(
			data,
			spec.path,
			freshWithin(
				withHiddenRows(value, field, { known: blocks, insideLocale: spec.localized, hidden }),
				field,
				{ own, known: blocks, insideLocale: spec.localized }
			)
		)
	}
}

/** Payload's collection of the documents editors have open in the admin. */
const LOCKS = 'payload-locked-documents' as CollectionSlug

/**
 * The lock another editor holds on one of `ids` of the collection `slug`, as Payload's own
 * save reads it: not the reviewer's and not run out. A lock whose editor is gone is another's.
 */
const heldLock = async (
	req: PayloadRequest,
	slug: string,
	ids: (number | string)[]
): Promise<{ id: string; by: string | null } | null> => {
	const config = req.payload.collections[slug as CollectionSlug]?.config
	const lockDocuments = config?.lockDocuments
	if (!config || lockDocuments === false || !req.payload.collections[LOCKS] || ids.length === 0) {
		return null
	}
	const duration = (typeof lockDocuments === 'object' ? lockDocuments.duration : 300) * 1000
	type Ref = number | string | { id: number | string } | null | undefined
	const { docs } = await req.payload.db.find<{
		id: number | string
		document?: { value: Ref }
		user?: { relationTo: string; value: Ref } | null
		updatedAt: string
	}>({
		collection: LOCKS,
		where: {
			and: [{ 'document.relationTo': { equals: slug } }, { 'document.value': { in: ids } }],
		},
		sort: '-updatedAt',
		limit: 0,
		pagination: false,
		req,
	})
	const idOf = (value: Ref) =>
		value === null || value === undefined
			? ''
			: String(typeof value === 'object' ? value.id : value)
	const byOf = (lock: (typeof docs)[number]) =>
		lock.user ? `${lock.user.relationTo}:${idOf(lock.user.value)}` : null
	const lock = docs.find(
		(entry) =>
			byOf(entry) !== userRef(req) && Date.now() - new Date(entry.updatedAt).getTime() <= duration
	)
	return lock ? { id: idOf(lock.document?.value), by: byOf(lock) } : null
}

/**
 * Why the merge waits for another editor, or null: one has a document of the group open.
 * Payload's save would drop their lock, and their next save would bring the old values back.
 */
export const lockRefusal = async (args: {
	req: PayloadRequest
	col: CollectionContext
	docs: LoadedDoc[]
}): Promise<string | null> => {
	const { req, col, docs } = args
	const lock = await heldLock(
		req,
		col.slug,
		docs.map((doc) => doc.id)
	)
	if (!lock) return null
	const doc = docs.find((one) => String(one.id) === lock.id)
	const title = doc ? await readableTitle(req, col, doc) : lock.id
	const by = lock.by
		? ((await describeUsers(req, [lock.by])).get(lock.by) ?? lock.by)
		: 'another user'
	return `"${title}" is open for editing by ${by}. Merge once they close it.`
}

/** Why the merge may not write a language, by what it would leave empty there; or null. */
export const missingRefusal = (
	req: PayloadRequest,
	col: CollectionContext,
	missing: MergePlan['missing']
): string | null => {
	if (missing.length === 0) return null
	// The field by its label where the spec has it, then the path below it, as `Steps > Text`.
	const name = (path: string) => {
		const parts = path.split('.')
		for (let size = parts.length; size > 0; size -= 1) {
			const label = col.specByPath.get(parts.slice(0, size).join('.'))?.label
			if (label === undefined && !col.specByPath.has(parts.slice(0, size).join('.'))) continue
			const head = label ? getTranslation(label, req.i18n) : toWords(parts[size - 1] as string)
			return [head, ...parts.slice(size).map((part) => toWords(part))].join(' > ')
		}
		return parts.map((part) => toWords(part)).join(' > ')
	}
	const reasons = {
		none: 'no document of the merge has a value there',
		kept: 'the merge may not take one from another document',
		rows: 'a row or group leaves it empty',
	}
	return missing
		.map(
			({ path, locale, reason }) =>
				`"${name(path)}" in ${locale} must have a value: ${reasons[reason]}.`
		)
		.join(' ')
}

/**
 * Why the reviewer may not apply this merge, or null, before the documents are read: the
 * plugin's `access.merge` and the collection's `update` access on the survivor.
 */
export const accessRefusal = async (args: {
	req: PayloadRequest
	ctx: PluginContext
	col: CollectionContext
	survivorId: number | string
}): Promise<string | null> => {
	const { req, ctx, col, survivorId } = args
	if (!(await ctx.options.access.merge({ req }))) return 'You may not merge documents.'
	if (!(await docAllowed({ req, col, operation: 'update', id: survivorId }))) {
		return 'You may not update the surviving document.'
	}
	return null
}

/**
 * Why the collection's own access refuses the absorbed documents leaving, or null, asked as
 * Payload asks it: a move to the trash is an update and a delete given the `deletedAt` it sets;
 * one of `deleted`, which gives up a unique value no other way, leaves for good.
 */
export const removalRefusal = async (args: {
	req: PayloadRequest
	col: CollectionContext
	absorbedIds: (number | string)[]
	deleted: string[]
}): Promise<string | null> => {
	const { req, col, absorbedIds, deleted } = args
	const trashing =
		col.options.absorbed === 'trash' ? { deletedAt: new Date().toISOString() } : undefined
	for (const id of absorbedIds) {
		const permanently = !trashing || deleted.includes(String(id))
		const data = permanently ? undefined : trashing
		if (
			(!permanently && !(await docAllowed({ req, col, operation: 'update', id, data }))) ||
			!(await docAllowed({ req, col, operation: 'delete', id, data }))
		) {
			return permanently && trashing
				? `You may not delete document ${String(id)}, which gives up a unique value the survivor takes.`
				: `You may not remove document ${String(id)}.`
		}
	}
	return null
}

/**
 * Apply a reviewed merge of a group of documents into one.
 *
 * The write order is what makes this safe on a database without transactions (MongoDB
 * on a single node opens none, and Payload does not complain): `hooks.beforeRemove` gets
 * the absorbed documents as they are, then they let go of the unique values the survivor
 * takes, then the survivor is written one locale at a time, and only then do the absorbed
 * documents leave. Any prefix of that sequence leaves every document in place, and a failure
 * is logged and sent as `merge.failed`. The exception is an absorbed document that can hold
 * neither a placeholder nor an empty value for a unique value the survivor takes: it leaves
 * before the survivor is written.
 */
export const applyMerge = async (args: ApplyMergeArgs): Promise<ApplyMergeResult> => {
	const { req, ctx, col, survivorId, absorbedIds, choices, expected } = args
	const { payload } = req

	checkGroup(args)
	const refused = await accessRefusal({ req, ctx, col, survivorId })
	if (refused) throw forbidden(refused)
	// What a merge carries over is what the reviewer could read.
	if (!(await allReadable({ req, col, ids: [survivorId, ...absorbedIds] }))) {
		throw forbidden(READ_REFUSED)
	}

	const { survivor, absorbed } = await loadMergeGroup({ req, ctx, col, survivorId, absorbedIds })
	for (const doc of [survivor, ...absorbed]) {
		const seen = expected?.[String(doc.id)]
		if (seen && seen !== doc.updatedAt) {
			throw new APIError(
				`Document ${String(doc.id)} changed since it was planned.`,
				409,
				undefined,
				true
			)
		}
	}
	// Publishing writes on top of the latest version, draft included, so a merge of the
	// published state would publish a draft the reviewer never saw.
	if (await survivorHasDraft({ req, col, id: survivorId })) {
		throw new APIError(
			'The surviving document has an unpublished draft. Publish or discard it first.',
			409,
			undefined,
			true
		)
	}

	const similar = await bySimilarity({
		req,
		col,
		survivorId: survivor.id,
		absorbedIds: absorbed.map((doc) => doc.id),
	})
	const writeLocale = await resolveWriteLocale({ req, ctx, col, survivor })
	const plan: MergePlan = planMerge({
		survivor,
		absorbed,
		fields: await mergeableSpec({ req, col, docs: [survivor, ...absorbed] }),
		locales: ctx.localeCodes,
		choices,
		collection: col.slug,
		schema: { fields: col.config.flattenedFields, blocks: req.payload.config.blocks },
		writeLocale,
		similar,
		validates: validatesWrite(col),
		publishesDrafts: publishesDrafts(col),
	})
	const missing = missingRefusal(req, col, plan.missing)
	if (missing) throw new APIError(missing, 409, undefined, true)
	if (!plan.readyToApply) {
		const outstanding = plan.decisions
			.filter((decision) => decision.requiresChoice)
			.map((decision) => decision.key)
		throw new APIError(
			`Decide these fields before applying: ${outstanding.join(', ')}.`,
			400,
			undefined,
			true
		)
	}

	const locked = await lockRefusal({ req, col, docs: [survivor, ...absorbed] })
	if (locked) throw new APIError(locked, 409, undefined, true)

	// The fields hidden from the API, which the documents as loaded lack: the rows the survivor
	// takes keep theirs, a unique one frees its value too, and the record's copy holds them,
	// since nothing else keeps them once a document is deleted. Not an auth collection's
	// credentials, which Payload hands out decrypted.
	const full = await loadDocs({
		req,
		ctx,
		col,
		ids: [survivor.id, ...absorbed.map((doc) => doc.id)],
		showHiddenFields: true,
	})
	const hidden = rowsById(full)
	const snapshots = full
		.filter((doc) => String(doc.id) !== String(survivor.id))
		.map((doc) =>
			col.config.auth
				? (Object.fromEntries(
						Object.entries(doc).filter(([key]) => !AUTH_FIELDS.has(key))
					) as typeof doc)
				: doc
		)

	const fullOf = new Map(full.map((one) => [String(one.id), one]))
	const releases = new Map<string, Awaited<ReturnType<typeof releaseUnique>>>()
	for (const doc of absorbed) {
		releases.set(
			String(doc.id),
			await releaseUnique({
				req,
				col,
				locales: ctx.localeCodes,
				// With the fields hidden from the API, which a unique index may hold.
				survivor: fullOf.get(String(survivor.id)) ?? survivor,
				absorbed: fullOf.get(String(doc.id)) ?? doc,
				plan,
				hidden,
			})
		)
	}
	const leavesFirst = (id: string) => (releases.get(id)?.release.deletes.length ?? 0) > 0
	const ids = absorbed.map((doc) => String(doc.id))
	const early = ids.filter(leavesFirst)
	const late = ids.filter((id) => !leavesFirst(id))
	const removing = await removalRefusal({ req, col, absorbedIds, deleted: early })
	if (removing) throw forbidden(removing)

	const transactional = await initTransaction(req)
	if (!transactional && ctx.options.requireTransactions) {
		throw new APIError(
			'The database did not open a transaction and `requireTransactions` is on.',
			503,
			undefined,
			true
		)
	}

	const draft = col.hasDrafts && col.options.draft
	const remove = (id: string) =>
		payload.delete({
			collection: col.slug,
			id,
			depth: 0,
			overrideAccess: true,
			overrideLock: true,
			context: dedupeContext(),
			req: localRequest(req),
		})

	try {
		// MongoDB starts a transaction on its first command, and a command sent beside it, as a
		// paginated find sends its count, finds none. The hook may begin with one, so the
		// transaction starts here, on a single command.
		if (transactional) {
			await payload.db.count({ collection: col.slug, where: { id: { equals: survivor.id } }, req })
		}
		await ctx.options.hooks.beforeRemove?.({
			req,
			collection: col.slug,
			survivorId: survivor.id,
			absorbedIds: absorbed.map((doc) => doc.id),
			snapshots: Object.fromEntries(snapshots.map((doc) => [String(doc.id), doc])),
			decisions: plan.decisions,
		})
		for (const id of early) await remove(id)
		for (const id of late) {
			// Through the database layer, so the host's hooks never see the placeholder as an
			// edit; the values it replaces are in the snapshot above.
			const update = releases.get(id)?.update
			if (!update) continue
			// Laid over the stored document, as Payload's own save lays its data: MongoDB sets every
			// top-level key it is given as one value, a group too, and SQL rewrites every localized
			// value of the row once it writes one.
			const stored = await payload.db.findOne<Record<string, unknown> & { id: number | string }>({
				collection: col.slug,
				where: { id: { equals: id } },
				locale: 'all',
				joins: false,
				req,
			})
			const whole = mergeData(stored ?? {}, update)
			const data =
				payload.db.name === 'mongoose'
					? Object.fromEntries(Object.keys(update).map((key) => [key, whole[key]]))
					: Object.fromEntries(Object.entries(whole).filter(([key]) => key !== 'id'))
			await payload.db.updateOne({ collection: col.slug, id, data, req })
			// With drafts every save starts from the newest version, the trash below too: without
			// the placeholder there it would bring the value back.
			if (col.hasDrafts) {
				const {
					docs: [latest],
				} = await payload.db.findVersions<Record<string, unknown>>({
					collection: col.slug,
					where: { and: [{ parent: { equals: id } }, { latest: { equals: true } }] },
					sort: '-updatedAt',
					limit: 1,
					pagination: false,
					req,
				})
				if (latest) {
					await payload.db.updateVersion({
						collection: col.slug,
						id: latest.id,
						versionData: {
							createdAt: latest.createdAt,
							latest: true,
							parent: latest.parent,
							updatedAt: latest.updatedAt,
							version: mergeData(latest.version, update),
						},
						req,
					})
				}
			}
		}

		const writes: Array<{ locale?: string; data: Record<string, unknown> }> = []
		if (ctx.localeCodes && writeLocale) {
			const shared = mergeData(plan.base, plan.byLocale[writeLocale] ?? {})
			if (Object.keys(shared).length > 0) writes.push({ locale: writeLocale, data: shared })
			for (const [locale, data] of Object.entries(plan.byLocale)) {
				if (locale === writeLocale) continue
				if (Object.keys(data).length > 0) writes.push({ locale, data })
			}
		} else if (Object.keys(plan.base).length > 0) {
			writes.push({ data: plan.base })
		}
		for (const write of writes) {
			withFreshRows({
				col,
				survivor,
				data: write.data,
				locale: write.locale,
				blocks: payload.config.blocks,
				hidden,
			})
		}
		// A list whose rows hold values per locale is written into every locale, the same rows
		// each time, so each locale's values land on the rows the first write made.
		const first = writes.find((write) => write.locale === writeLocale)
		const listsPerLocale = first && ctx.localeCodes ? col.spec : []
		for (const spec of listsPerLocale) {
			if (spec.localized || (spec.type !== 'array' && spec.type !== 'blocks')) continue
			const value = readPath(first?.data ?? {}, spec.path)
			const field = getFieldByPath({ fields: col.config.flattenedFields, path: spec.path })?.field
			if (value === undefined || !field) continue
			const known = payload.config.blocks
			if (!fieldsWithin(field, known).some((sub) => perLocale(sub, false))) continue
			for (const locale of ctx.localeCodes ?? []) {
				// A language the rows hold nothing in is left alone: Payload would check every
				// required field of it, and the survivor may have none there.
				// Read before the hidden fields went back into the rows, as the plan reads it.
				const planned = readPath(plan.base, spec.path)
				if (locale !== writeLocale && !heldIn(planned, field, { locale, known })) continue
				let write = writes.find((entry) => entry.locale === locale)
				if (!write) {
					write = { locale, data: {} }
					writes.push(write)
				}
				writePath(write.data, spec.path, inLocale(value, field, { locale, known }))
			}
		}
		const write = (locale: string | undefined, data: Record<string, unknown>, asDraft: boolean) =>
			payload.update({
				collection: col.slug,
				id: survivor.id,
				data,
				...(locale ? { locale } : {}),
				depth: 0,
				draft: asDraft,
				overrideAccess: true,
				overrideLock: true,
				context: dedupeContext(),
				req: localRequest(req),
			})
		// A drafted locale goes last, as a draft: the publish after it starts from the newest
		// version and checks the write locale alone, as Payload publishes any draft.
		const drafted = (entry: { locale?: string }) =>
			entry.locale !== undefined && plan.drafted.includes(entry.locale)
		for (const entry of writes.filter((entry) => !drafted(entry))) {
			await write(entry.locale, entry.data, draft)
		}
		for (const entry of writes.filter(drafted)) await write(entry.locale, entry.data, true)
		if (plan.drafted.length > 0 && writeLocale) {
			await write(writeLocale, { _status: 'published' }, false)
		}

		for (const id of late) {
			if (col.options.absorbed === 'trash') {
				await payload.update({
					collection: col.slug,
					id,
					data: { deletedAt: new Date().toISOString() },
					depth: 0,
					overrideAccess: true,
					overrideLock: true,
					context: dedupeContext(),
					req: localRequest(req),
				})
			} else {
				await remove(id)
			}
		}

		for (const id of ids) await col.adapter.remove?.({ req, collection: col.slug, id })
		// The survivor now carries values it did not have; indexed again, the next look-alike
		// is found by them.
		if (col.options.match) {
			const merged = await loadDoc({ req, ctx, col, id: survivor.id })
			if (merged) {
				await col.adapter.index?.({ req, collection: col.slug, doc: merged })
				await checkDocument({ req, ctx, col, doc: merged })
			}
		}
		await closePairsFor({ req, col, docIds: ids })

		if (transactional) await commitTransaction(req)
	} catch (error) {
		await killTransaction(req)
		payload.logger.error(
			{
				err: error,
				collection: col.slug,
				survivorId: survivor.id,
				absorbedIds: ids,
				transactional,
			},
			'[dedupe] merge failed'
		)
		await emitEvent(
			ctx.options.events,
			{
				type: 'merge.failed',
				collection: col.slug,
				survivorId: String(survivor.id),
				absorbedIds: ids,
				error: error instanceof Error ? error.message : String(error),
			},
			req
		)
		throw error
	}

	await emitEvent(
		ctx.options.events,
		{
			type: 'merge.applied',
			collection: col.slug,
			survivorId: String(survivor.id),
			absorbedIds: ids,
		},
		req
	)

	return { survivorId: String(survivor.id) }
}
