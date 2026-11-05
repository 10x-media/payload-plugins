/**
 * How `user` and `impersonator` are stored: the auth collection and the id as text, one
 * shape whether the host has one auth collection or several.
 */
export type UserRef = { relationTo: string; value: string }

/** The ref for a user given by collection and id. */
export const userRef = (collection: string, id: number | string): UserRef => ({
	relationTo: collection,
	value: String(id),
})

/** The acting user of a request, when it has one. */
export const actingUserRef = (user: unknown): UserRef | undefined => {
	if (!user || typeof user !== 'object') {
		return undefined
	}
	const { collection, id } = user as { collection?: unknown; id?: unknown }
	return typeof collection === 'string' && collection.length > 0 && isId(id)
		? userRef(collection, id)
		: undefined
}

/**
 * Impersonator copied off the acting user at write time.
 *
 * `@10x-media/impersonation` sets `_impersonation` only for the target session.
 * Reading it here keeps the row tied to this request. Looking the session up
 * later cannot tell these actions from the real user's in the same window.
 */
export const impersonatorRef = (user: unknown): UserRef | undefined => {
	if (!user || typeof user !== 'object') {
		return undefined
	}
	return actingUserRef(
		(user as { _impersonation?: { impersonator?: unknown } })._impersonation?.impersonator
	)
}

const isId = (value: unknown): value is number | string =>
	typeof value === 'number' || (typeof value === 'string' && value.length > 0)
