import type { ListQuery } from 'payload'

import type { Target } from '../types'

/** The panel's whole URL contract: which overlay is open, and what it is pointed at. */
export type State = { overlayId: null | string; target: Target }

export const CLOSED: State = { overlayId: null, target: {} }

/**
 * `system/communities/abc` to `{ overlayId: 'system', target: { item: 'communities', id: 'abc' } }`.
 *
 * A hand-edited or truncated value must not throw: `decodeURIComponent` rejects a stray percent
 * (`system/100%`), and anything it rejects reads as closed. The list query travels in a second
 * parameter, parsed here and merged into the same target.
 */
export const parseParam = (value: null | string, queryValue?: null | string): State => {
	if (!value) {
		return CLOSED
	}
	try {
		const [overlayId, item, id] = value.split('/').map(decodeURIComponent)
		if (!overlayId) {
			return CLOSED
		}
		const query = id ? undefined : parseQueryParam(queryValue ?? null)
		return {
			overlayId,
			target: {
				...(item ? { item } : {}),
				...(id ? { id } : {}),
				...(query ? { query } : {}),
			},
		}
	} catch {
		return CLOSED
	}
}

export const formatParam = (state: State): null | string => {
	if (!state.overlayId) {
		return null
	}
	return [state.overlayId, state.target.item, state.target.id]
		.filter((part): part is string => Boolean(part))
		.map(encodeURIComponent)
		.join('/')
}

/**
 * The list query as JSON. Payload's own list writes `where[...]`-style parameters; the panel
 * keeps one opaque value instead, because the page under the panel may itself be a list view
 * reading those very names. Anything that does not parse to an object reads as no query.
 */
export const parseQueryParam = (value: null | string): ListQuery | undefined => {
	if (!value) {
		return undefined
	}
	try {
		const parsed: unknown = JSON.parse(value)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return undefined
		}
		return parsed as ListQuery
	} catch {
		return undefined
	}
}

type WhereCondition = Record<string, unknown>
type WhereGroup = { and?: WhereCondition[] }
type WhereOr = { or?: WhereGroup[] }

/** True for `{ name: { equals: 'x' } }`; false for `{ name: { equals: undefined } }` or `{ name: {} }`. */
const isCompleteCondition = (condition: WhereCondition): boolean =>
	Object.values(condition).some(
		(operators) =>
			operators !== null &&
			typeof operators === 'object' &&
			Object.values(operators as Record<string, unknown>).some((value) => value !== undefined)
	)

/**
 * The filter builder keeps a half-built row (a field picked, no value yet) as a condition with an
 * `undefined` value. That belongs in memory, where the builder reads it back, not in a link: JSON
 * would turn it into `{ name: {} }`, which Payload's validator rejects, and a reload would then
 * drop every row. Only complete conditions are written to the URL.
 */
export const pruneWhereForUrl = (where: unknown): unknown => {
	if (!where || typeof where !== 'object') {
		return where
	}
	const { or, ...rest } = where as Record<string, unknown> & WhereOr
	if (!Array.isArray(or)) {
		return where
	}
	const groups = or
		.map((group) => ({
			...group,
			and: Array.isArray(group?.and) ? group.and.filter(isCompleteCondition) : group?.and,
		}))
		.filter((group) => Array.isArray(group.and) && group.and.length > 0)
	if (groups.length === 0) {
		return Object.keys(rest).length ? rest : undefined
	}
	return { ...rest, or: groups }
}

export const formatQueryParam = (query: ListQuery | undefined): null | string => {
	if (!query) {
		return null
	}
	const { where, ...rest } = query as ListQuery & { where?: unknown }
	const prunedWhere = pruneWhereForUrl(where)
	const forUrl = prunedWhere ? { ...rest, where: prunedWhere } : rest
	const json = JSON.stringify(forUrl)
	return json === '{}' ? null : json
}

/** In memory the half-built row counts, so two queries compare on everything they hold. */
const sameQuery = (a: ListQuery | undefined, b: ListQuery | undefined): boolean => {
	const encode = (value: ListQuery | undefined) =>
		JSON.stringify(value ?? null, (_key, inner: unknown) =>
			inner === undefined ? '__undefined__' : inner
		)
	return encode(a) === encode(b)
}

export const sameState = (a: State, b: State): boolean =>
	a.overlayId === b.overlayId &&
	a.target.item === b.target.item &&
	a.target.id === b.target.id &&
	sameQuery(a.target.query as ListQuery | undefined, b.target.query as ListQuery | undefined)

/**
 * Equality as the URL would see it: a state whose only extra is a half-built condition writes the
 * same URL as one without it, so a URL read back must not count as a change. This is the
 * comparison for anything arriving from the address bar; `sameState` is for memory.
 */
export const sameUrlState = (a: State, b: State): boolean =>
	formatParam(a) === formatParam(b) &&
	formatQueryParam(a.target.query as ListQuery | undefined) ===
		formatQueryParam(b.target.query as ListQuery | undefined)
