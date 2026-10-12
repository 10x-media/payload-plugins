import { type FieldAccess, type FlattenedField, getFieldByPath, type PayloadRequest } from 'payload'

import type { CollectionContext } from '../plugin/context'
import type { MergeDecision, ReviewedFieldSpec } from '../schema/types'
import {
	fieldsWithin,
	isEmpty,
	isEmptyGroup,
	isPlainObject,
	partsWithin,
	perLocale,
	readPath,
} from './compare'
import type { LoadedDoc } from './load'

/** A field's access check, with the object the field sits in. */
type Check = { field: FlattenedField; siblingData: unknown }

type Row = Record<string, unknown>

/** The field at `path` and every group or tab it sits in: access on a group covers what it holds. */
const checksAlong = (col: CollectionContext, path: string, doc: LoadedDoc | undefined): Check[] => {
	const parts = path.split('.')
	return parts.flatMap((_, index) => {
		const found = getFieldByPath({
			fields: col.config.flattenedFields,
			path: parts.slice(0, index + 1).join('.'),
		})
		const siblingData = index === 0 ? doc : readPath(doc ?? {}, parts.slice(0, index).join('.'))
		return found ? [{ field: found.field, siblingData }] : []
	})
}

const guarded = (fields: FlattenedField[], operation: 'read' | 'update') =>
	fields.some((field) => 'access' in field && field.access?.[operation])

/**
 * The fields' own access, asked as Payload asks it: with the document, and the object each
 * field sits in as `siblingData`. A check that throws, such as one that reads a document the
 * record no longer has, counts as a refusal.
 */
const allowed = async (
	checks: Check[],
	operation: 'read' | 'update',
	args: { req: PayloadRequest; doc: LoadedDoc | undefined }
): Promise<boolean> => {
	const { req, doc } = args
	for (const { field, siblingData } of checks) {
		const check =
			'access' in field ? (field.access?.[operation] as FieldAccess | undefined) : undefined
		if (!check) continue
		try {
			if (!(await check({ req, id: doc?.id, doc, data: doc, siblingData: siblingData as Row })))
				return false
		} catch {
			return false
		}
	}
	return true
}

/** Whether the reader may read the field at `path` of `doc`, as Payload asks it. */
export const fieldReadable = (
	req: PayloadRequest,
	{ col, path, doc }: { col: CollectionContext; path: string; doc: LoadedDoc }
): Promise<boolean> => allowed(checksAlong(col, path, doc), 'read', { req, doc })

/** `value` of a field inside a row, one locale's value at a time when it holds one per locale. */
const eachLocale = (field: FlattenedField, value: unknown, insideLocale: boolean): unknown[] =>
	perLocale(field, insideLocale) && isPlainObject(value) ? Object.values(value) : [value]

/**
 * Whether every field in the rows, groups and blocks of `value` lets the reviewer change it.
 * `insideLocale` says that `value` is one locale's value.
 */
const changeableWithin = async (
	field: FlattenedField,
	value: unknown,
	args: { req: PayloadRequest; doc: LoadedDoc | undefined; insideLocale: boolean }
): Promise<boolean> => {
	for (const { fields, row } of partsWithin(field, value, args.req.payload.config.blocks)) {
		for (const sub of fields) {
			if (!(await allowed([{ field: sub, siblingData: row }], 'update', args))) return false
			const own = perLocale(sub, args.insideLocale)
			for (const one of eachLocale(sub, row[sub.name], args.insideLocale)) {
				const inner = { ...args, insideLocale: args.insideLocale || own }
				if (!(await changeableWithin(sub, one, inner))) return false
			}
		}
	}
	return true
}

/** Whether `value` holds anything, down through groups and locales. */
const holds = (value: unknown): boolean => !isEmpty(value) && !isEmptyGroup(value)

/** Whether `there` holds a value `own` lacks: what stripping by another document lets through. */
const reveals = (there: unknown, own: unknown): boolean => {
	if (Array.isArray(there)) {
		return there.some((item, index) => reveals(item, Array.isArray(own) ? own[index] : undefined))
	}
	if (!isPlainObject(there)) return false
	return Object.entries(there).some(([key, value]) =>
		isPlainObject(own) && key in own ? reveals(value, own[key]) : holds(value)
	)
}

/**
 * The merge spec as this reviewer may merge it:
 * - a field they may not update keeps the survivor's value, and so does a list with a row, in
 *   any document of the group, holding such a field;
 * - a field whose own `read` hides a value on its document but shows the field on a document
 *   of the group keeps the survivor's value too, so the merge brings nothing into view;
 * - a field they may not read on the survivor is merged by its policy, unseen, like one the
 *   admin hides.
 * `docs` holds the survivor first.
 */
export const mergeableSpec = async (args: {
	req: PayloadRequest
	col: CollectionContext
	docs: LoadedDoc[]
}): Promise<ReviewedFieldSpec[]> => {
	const { req, col, docs } = args
	const survivor = docs[0]
	const known = req.payload.config.blocks
	return Promise.all(
		col.spec.map(async (spec) => {
			const along = checksAlong(col, spec.path, survivor)
			const field = along[along.length - 1]?.field
			const reads = guarded(
				along.map((check) => check.field),
				'read'
			)
			const readable = await Promise.all(
				docs.map(
					async (doc) =>
						!reads || (await allowed(checksAlong(col, spec.path, doc), 'read', { req, doc }))
				)
			)
			const seen = (out: ReviewedFieldSpec): ReviewedFieldSpec =>
				readable[0] ? out : { ...out, hidden: true, unread: true }
			const locked = seen({ ...spec, policy: 'survivor', locked: true })
			const kept = seen({ ...spec, policy: 'survivor', sealed: true })
			if (!(await allowed(along, 'update', { req, doc: survivor }))) return locked
			if (!field) return seen(spec)
			const within = fieldsWithin(field, known)
			const each = (doc: LoadedDoc) => {
				const value = readPath(doc, spec.path)
				return spec.localized && isPlainObject(value) ? Object.values(value) : [value]
			}
			const inner = { req, insideLocale: spec.localized }
			if (guarded(within, 'update')) {
				for (const doc of docs) {
					for (const one of each(doc)) {
						if (!(await changeableWithin(field, one, { ...inner, doc: survivor }))) return locked
					}
				}
			}
			if (readable.slice(1).some((shown) => !shown) && readable.some(Boolean)) return kept
			if (guarded(within, 'read')) {
				for (const doc of docs.slice(1)) {
					for (const one of each(doc)) {
						const own = await readableWithin(field, one, { ...inner, doc })
						const there = await readableWithin(field, one, { ...inner, doc: survivor })
						if (reveals(there, own)) return kept
					}
				}
			}
			return seen(spec)
		})
	)
}

/**
 * `value` of `field` without what the reader may not read in its rows, groups and blocks.
 * `insideLocale` says that `value` is one locale's value.
 */
const readableWithin = async (
	field: FlattenedField,
	value: unknown,
	args: { req: PayloadRequest; doc: LoadedDoc | undefined; insideLocale: boolean }
): Promise<unknown> => {
	const readable = async (fields: FlattenedField[], row: Row) => {
		const kept = { ...row }
		for (const sub of fields) {
			if (!(sub.name in kept)) continue
			if (!(await allowed([{ field: sub, siblingData: row }], 'read', args))) {
				delete kept[sub.name]
				continue
			}
			const inner = kept[sub.name]
			kept[sub.name] =
				perLocale(sub, args.insideLocale) && isPlainObject(inner)
					? Object.fromEntries(
							await Promise.all(
								Object.entries(inner).map(async ([code, one]) => [
									code,
									await readableWithin(sub, one, { ...args, insideLocale: true }),
								])
							)
						)
					: await readableWithin(sub, inner, args)
		}
		return kept
	}
	const parts = partsWithin(field, value, args.req.payload.config.blocks)
	if (field.type === 'group' || field.type === 'tab') {
		return parts[0] ? readable(parts[0].fields, parts[0].row) : value
	}
	if (!Array.isArray(value)) return value
	const byRow = new Map(parts.map((part) => [part.row, part.fields]))
	return Promise.all(
		value.map((row) => (isPlainObject(row) ? readable(byRow.get(row) ?? [], row) : row))
	)
}

/**
 * The decisions without the values this reader may not read, by the fields' own access: a
 * document's value goes when the field refuses that document, the result when it refuses
 * the survivor. `docs` holds each document of the merge by id, as it was merged.
 */
export const withoutUnreadable = async <T extends MergeDecision>(args: {
	req: PayloadRequest
	col: CollectionContext
	decisions: T[]
	docs: Record<string, LoadedDoc | undefined>
}): Promise<T[]> => {
	const { req, col, decisions, docs } = args
	return Promise.all(
		decisions.map(async (decision) => {
			const fields = checksAlong(col, decision.path, undefined).map((check) => check.field)
			const field = fields[fields.length - 1]
			const within = field ? guarded(fieldsWithin(field, req.payload.config.blocks), 'read') : false
			if (!guarded(fields, 'read') && !within) return decision
			const shown = async (id: string, value: unknown) => {
				const doc = docs[id]
				const along = checksAlong(col, decision.path, doc)
				if (!(await allowed(along, 'read', { req, doc }))) return undefined
				const insideLocale = Boolean(decision.locale)
				return field && within ? readableWithin(field, value, { req, doc, insideLocale }) : value
			}
			const values = await Promise.all(
				decision.values.map(async (entry) => ({
					...entry,
					value: await shown(entry.doc, entry.value),
				}))
			)
			const survivor = decision.values[0]?.doc as string
			return { ...decision, values, proposed: await shown(survivor, decision.proposed) }
		})
	)
}
