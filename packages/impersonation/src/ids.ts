import type { CollectionSlug, Payload } from 'payload'

import type { UserLabel } from './types'

/** Payload ids are strings on Mongo and numbers on Postgres; compare as text. */
export const idsEqual = (a: unknown, b: unknown): boolean =>
	a != null && b != null && String(a) === String(b)

export const asId = (value: unknown): number | string | null => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}
	if (typeof value === 'string' && value.length > 0) {
		return value
	}
	return null
}

/** Index `payload.collections` with a runtime slug. Generated types are a closed Record. */
export const collectionBySlug = (payload: Payload, slug: string) =>
	payload.collections[slug as CollectionSlug]

/**
 * Display name for a user doc: its collection's `useAsTitle` value, else the
 * email. Snapshotted on the session row so every surface shows the same name.
 */
export const userTitle = (
	payload: Payload,
	slug: string,
	doc: null | Record<string, unknown> | undefined
): string | undefined => {
	const field = collectionBySlug(payload, slug)?.config.admin?.useAsTitle
	const value = field && field !== 'id' ? doc?.[field] : undefined
	if (typeof value === 'string' && value.trim()) {
		return value.trim()
	}
	if (typeof value === 'number') {
		return String(value)
	}
	return typeof doc?.email === 'string' && doc.email ? doc.email : undefined
}

/** Pick the snapshotted title or email per `ui.userLabel`; either falls back to the other. */
export const labelUser = (
	mode: UserLabel,
	user: { email?: null | string; title?: null | string }
): string | undefined =>
	(mode === 'email' ? user.email || user.title : user.title || user.email) || undefined
