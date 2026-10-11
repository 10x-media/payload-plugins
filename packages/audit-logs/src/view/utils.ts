import type { Filters } from './types'

export const GLOBAL_SENTINEL = '__global__'

type Label = Record<string, string> | string | ((args: { i18n: unknown; t: unknown }) => string)

/** A configured label as text: plain, per language, or a function. `false` and unset give nothing. */
export const labelOf = (
	label: unknown,
	i18n: { language: string; t: unknown }
): string | undefined => {
	const value = label as Label | undefined
	if (typeof value === 'string') return value
	if (typeof value === 'function') return value({ i18n, t: i18n.t })
	if (value && typeof value === 'object') {
		return value[i18n.language] ?? value.en ?? Object.values(value)[0]
	}
	return undefined
}

/** Date presets the Date filter offers; each fills `dateFrom` relative to now. */
export const DATE_RANGES = ['24h', '7d', '30d'] as const
export type DateRange = (typeof DATE_RANGES)[number]

const RANGE_MS: Record<DateRange, number> = {
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000,
}

/** Start of a preset window as an ISO string, relative to `now`. */
export const rangeStart = (range: DateRange, now: number = Date.now()): string =>
	new Date(now - RANGE_MS[range]).toISOString()

/**
 * The preset a `dateFrom` was set from, while it still matches within 1% of the
 * preset's window, so the Date pill keeps reading "Last 7 days" until it clearly
 * no longer is.
 */
export const matchingRange = (
	dateFrom: string | undefined,
	dateTo: string | undefined,
	now: number = Date.now()
): DateRange | undefined => {
	if (!dateFrom || dateTo) return undefined
	const from = Date.parse(dateFrom)
	return DATE_RANGES.find(
		(range) => Math.abs(from - (now - RANGE_MS[range])) <= RANGE_MS[range] * 0.01
	)
}

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

/**
 * A `user` or `impersonator` value as the row shows it. `slug` is missing only when
 * a bare id cannot be tied to a collection, which happens with several auth
 * collections and a value stored before the field went polymorphic.
 */
export type ResolvedUser = {
	deleted: boolean
	id: string
	label: string
	slug?: string
}

const onlySlug = (userTitleFields: Record<string, string>): string | undefined => {
	const slugs = Object.keys(userTitleFields)
	return slugs.length === 1 ? slugs[0] : undefined
}

const isId = (value: unknown): value is number | string =>
	(typeof value === 'string' && value.length > 0) || typeof value === 'number'

const fromDoc = (
	doc: Record<string, unknown>,
	slug: string | undefined,
	userTitleFields: Record<string, string>
): ResolvedUser | undefined => {
	if (!isId(doc.id)) return undefined
	const id = String(doc.id)
	const titleField = slug ? userTitleFields[slug] : undefined
	const title = titleField ? doc[titleField] : undefined
	return { deleted: false, id, label: isId(title) ? String(title) : id, slug }
}

/**
 * The view reads with `overrideAccess`, so a relationship that comes back as a bare
 * id instead of a document points at a user that no longer exists.
 */
export const resolveUser = (
	value: unknown,
	userTitleFields: Record<string, string>
): ResolvedUser | undefined => {
	if (isId(value)) {
		return {
			deleted: true,
			id: String(value),
			label: String(value),
			slug: onlySlug(userTitleFields),
		}
	}
	if (!value || typeof value !== 'object') return undefined
	const record = value as Record<string, unknown>
	if (typeof record.relationTo === 'string') {
		const slug = record.relationTo
		if (isId(record.value)) {
			return { deleted: true, id: String(record.value), label: String(record.value), slug }
		}
		return record.value && typeof record.value === 'object'
			? fromDoc(record.value as Record<string, unknown>, slug, userTitleFields)
			: undefined
	}
	return fromDoc(record, onlySlug(userTitleFields), userTitleFields)
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
	for (const type of filters.eventTypes ?? []) params.append('eventType', type)
	for (const ref of filters.documents ?? []) params.append('documentId', ref)
	for (const path of filters.changedPaths ?? []) params.append('changedPath', path)
	for (const t of filters.tenants ?? []) params.append('tenant', t)
	for (const ref of filters.users ?? []) params.append('userId', ref)
	for (const group of filters.groups ?? []) params.append('group', group)
	for (const api of filters.apis ?? []) params.append('api', api)
	if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
	if (filters.dateTo) params.set('dateTo', filters.dateTo)
	if (page && page > 1) params.set('page', String(page))
	if (limit) params.set('limit', String(limit))
	return params.toString()
}
