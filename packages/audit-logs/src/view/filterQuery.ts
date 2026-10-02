import type { Where } from 'payload'

import type { Filters } from './types'
import { GLOBAL_SENTINEL } from './utils'

type Params = Record<string, string | string[] | undefined>

const all = (v: string | string[] | undefined): string[] =>
	(Array.isArray(v) ? v : v ? [v] : []).filter(Boolean)

const one = (v: string | string[] | undefined): string | undefined => all(v)[0]

const listOrUndefined = (values: string[]): string[] | undefined =>
	values.length ? values : undefined

/**
 * A document or user reference as the URL carries it: `slug:id` when the picker
 * knew the collection, a bare id when it was typed in (a deleted document has no
 * page to pick it from).
 */
export const splitRef = (ref: string): { id: string; slug?: string } => {
	const at = ref.indexOf(':')
	return at > 0 ? { id: ref.slice(at + 1), slug: ref.slice(0, at) } : { id: ref }
}

/** The URL as `Filters`. Every list filter repeats its key, one value each. */
export const parseFilters = (sp: Params, { useTenant = false } = {}): Filters => {
	const globals = all(sp.global)
	return {
		changedPaths: listOrUndefined(all(sp.changedPath)),
		collections: listOrUndefined(all(sp.collection)),
		dateFrom: one(sp.dateFrom),
		dateTo: one(sp.dateTo),
		// A global's slug is stored as its documentId, so a globals filter owns that column.
		documents: globals.length ? undefined : listOrUndefined(all(sp.documentId)),
		eventTypes: listOrUndefined(all(sp.eventType)),
		globals: listOrUndefined(globals),
		groups: listOrUndefined(all(sp.group)),
		operations: listOrUndefined(all(sp.operation)),
		tenants: useTenant ? undefined : listOrUndefined(all(sp.tenant)),
		users: listOrUndefined(all(sp.userId)),
	}
}

const inOrEquals = (path: string, values: string[]): Where =>
	values.length === 1 ? { [path]: { equals: values[0] } } : { [path]: { in: values } }

const anyOf = (parts: Where[]): Where | undefined => {
	if (parts.length === 0) return undefined
	return parts.length === 1 ? parts[0] : { or: parts }
}

type WhereContext = {
	/** Locked by the tenant-scoped view; wins over the tenant filter. */
	lockedTenantId?: string
	/** Auth collections, which decide whether `user` is stored polymorphic. */
	userCollections: string[]
}

/**
 * The conditions for `filters`, AND-ed by the caller. Values inside one filter
 * match any of them; collections and globals together also match either.
 */
export const filterConditions = (filters: Filters, ctx: WhereContext): Where[] => {
	const conditions: Where[] = []
	const push = (where: Where | undefined) => {
		if (where) conditions.push(where)
	}

	push(
		anyOf([
			...(filters.collections?.length ? [inOrEquals('relationTo', filters.collections)] : []),
			...(filters.globals?.length
				? [
						{
							and: [
								{ relationTo: { equals: GLOBAL_SENTINEL } },
								inOrEquals('documentId', filters.globals),
							],
						},
					]
				: []),
		])
	)

	// "Any of the picked events": an operation picked whole, or a single event type.
	push(
		anyOf([
			...(filters.operations?.length ? [inOrEquals('operation', filters.operations)] : []),
			...(filters.eventTypes?.length ? [inOrEquals('eventType', filters.eventTypes)] : []),
		])
	)

	if (filters.documents?.length) {
		const refs = filters.documents.map(splitRef)
		const bare = refs.filter((r) => !r.slug).map((r) => r.id)
		push(
			anyOf([
				...refs
					.filter((r) => r.slug)
					.map((r) => ({
						and: [{ relationTo: { equals: r.slug } }, { documentId: { equals: r.id } }],
					})),
				...(bare.length ? [inOrEquals('documentId', bare)] : []),
			])
		)
	}

	if (filters.users?.length) {
		const refs = filters.users.map(splitRef)
		if (ctx.userCollections.length > 1) {
			const bare = refs.filter((r) => !r.slug).map((r) => r.id)
			push(
				anyOf([
					...refs
						.filter((r) => r.slug)
						.map((r) => ({
							and: [{ 'user.relationTo': { equals: r.slug } }, { 'user.value': { equals: r.id } }],
						})),
					...(bare.length ? [inOrEquals('user.value', bare)] : []),
				])
			)
		} else {
			push(
				inOrEquals(
					'user',
					refs.map((r) => r.id)
				)
			)
		}
	}

	if (ctx.lockedTenantId) push({ tenant: { equals: ctx.lockedTenantId } })
	else if (filters.tenants?.length) push(inOrEquals('tenant', filters.tenants))

	if (filters.groups?.length) push(inOrEquals('group', filters.groups))
	if (filters.changedPaths?.length) push({ changedPaths: { in: filters.changedPaths } })

	if (filters.dateFrom) push({ createdAt: { greater_than_equal: filters.dateFrom } })
	if (filters.dateTo) push({ createdAt: { less_than_equal: filters.dateTo } })

	return conditions
}
