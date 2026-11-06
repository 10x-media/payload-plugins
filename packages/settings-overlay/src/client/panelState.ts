import type { ListQuery } from 'payload'

import type { Target } from '../types'

/** Which overlay is open, and what it is pointed at. */
export type State = { overlayId: null | string; target: Target }

export const CLOSED: State = { overlayId: null, target: {} }

/**
 * A link's `settings` value, `system/communities/abc`, to
 * `{ overlayId: 'system', target: { item: 'communities', id: 'abc' } }`.
 *
 * A hand-edited or truncated value must not throw: `decodeURIComponent` rejects a stray percent
 * (`system/100%`), and anything it rejects reads as closed.
 */
export const parseParam = (value: null | string): State => {
	if (!value) {
		return CLOSED
	}
	try {
		const [overlayId, item, id] = value.split('/').map(decodeURIComponent)
		if (!overlayId) {
			return CLOSED
		}
		return {
			overlayId,
			target: {
				...(item ? { item } : {}),
				...(id ? { id } : {}),
			},
		}
	} catch {
		return CLOSED
	}
}

/**
 * Two queries compare on everything they hold, a half-built filter condition (a field picked, no
 * value yet, so `undefined`) included: the filter builder reads it back from the state.
 */
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
