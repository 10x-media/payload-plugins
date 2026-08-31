import type { Filters } from './types'

export const GLOBAL_SENTINEL = '__global__'

export const OPERATION_LABELS: Record<string, string> = {
	auth: 'Auth',
	create: 'Create',
	custom: 'Custom',
	delete: 'Delete',
	update: 'Update',
}

/**
 * Badge modifier for a `payloadAPI` value. The stored value is free text and may come
 * from any plugin, so anything outside `[a-z0-9]` folds to a dash to keep the class
 * name valid. Values without a dedicated rule fall back to the base `al-badge--api`.
 */
export const apiBadgeClass = (payloadAPI: string): string =>
	`al-badge--api-${payloadAPI.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/**
 * Label for a `payloadAPI` value, falling back to the value itself. Own keys only: the
 * value is free text, so an inherited property name would otherwise resolve to something
 * off `Object.prototype` and be handed to React as a child.
 */
export const apiLabel = (payloadAPI: string, labels: Record<string, string>): string =>
	(Object.hasOwn(labels, payloadAPI) ? labels[payloadAPI] : undefined) ?? payloadAPI

export const displayUser = (user: unknown, userTitleFields: Record<string, string>): string => {
	if (!user) return '—'
	if (typeof user === 'string' || typeof user === 'number') return String(user)
	if (typeof user === 'object' && user !== null) {
		const u = user as Record<string, unknown>
		// Polymorphic populated: { relationTo: 'users', value: { id, email, ... } }
		if (typeof u.relationTo === 'string' && u.value && typeof u.value === 'object') {
			const doc = u.value as Record<string, unknown>
			const titleField = userTitleFields[u.relationTo] ?? 'id'
			return String(doc[titleField] ?? doc.id ?? '—')
		}
		// Non-polymorphic populated: direct doc, single auth collection
		// Read out rather than indexed: a length check does not tell the compiler the element
		// exists. The single entry condition is unchanged.
		const entries = Object.entries(userTitleFields)
		const [onlyEntry] = entries
		if (entries.length === 1 && onlyEntry) {
			const titleField = onlyEntry[1]
			if (titleField !== 'id' && u[titleField]) return String(u[titleField])
		}
		if (u.id) return String(u.id)
	}
	return String(user)
}

export const formatDate = (iso: string): string => {
	try {
		return new Date(iso).toLocaleString(undefined, {
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			month: 'short',
			second: '2-digit',
			year: 'numeric',
		})
	} catch {
		return iso
	}
}

export const formatValue = (val: unknown): string => {
	if (val === null || val === undefined) return '—'
	if (typeof val === 'string') return val
	if (typeof val === 'number' || typeof val === 'boolean') return String(val)
	return JSON.stringify(val, null, 2)
}

export const isLongValue = (val: unknown): boolean =>
	typeof val === 'object' && val !== null && JSON.stringify(val).length > 80

export const buildParams = (filters: Filters, page?: number, limit?: number): string => {
	const params = new URLSearchParams()
	for (const c of filters.collections ?? []) params.append('collection', c)
	for (const g of filters.globals ?? []) params.append('global', g)
	for (const op of filters.operations ?? []) params.append('operation', op)
	if (filters.documentId) params.set('documentId', filters.documentId)
	if (filters.eventType) params.set('eventType', filters.eventType)
	for (const path of filters.changedPaths ?? []) params.append('changedPath', path)
	for (const t of filters.tenants ?? []) params.append('tenant', t)
	for (const id of filters.userIds ?? []) params.append('userId', id)
	if (filters.userCollection) params.set('userCollection', filters.userCollection)
	if (filters.group) params.set('group', filters.group)
	if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
	if (filters.dateTo) params.set('dateTo', filters.dateTo)
	if (page && page > 1) params.set('page', String(page))
	if (limit) params.set('limit', String(limit))
	return params.toString()
}
