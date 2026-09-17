import type { CollectionSlug, Payload } from 'payload'

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
