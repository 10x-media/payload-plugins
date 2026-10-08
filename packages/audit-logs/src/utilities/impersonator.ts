/**
 * Relationship value stored on `user` and `impersonator`.
 * Polymorphic when the host has more than one auth collection.
 */
export type AuditRelationship = number | string | { relationTo: string; value: number | string }

type ImpersonatorRef = { collection: string; id: number | string }

/**
 * Impersonator copied off the acting user at write time.
 *
 * `@10x-media/impersonation` sets `_impersonation` only for the target session.
 * Reading it here keeps the row tied to this request. Looking the session up
 * later cannot tell these actions from the real user's in the same window.
 */
export const impersonatorRelationship = (
	user: unknown,
	isPolymorphic: boolean
): AuditRelationship | undefined => {
	const ref = impersonatorRef(user)
	if (!ref) {
		return undefined
	}
	return isPolymorphic ? { relationTo: ref.collection, value: ref.id } : ref.id
}

const impersonatorRef = (user: unknown): ImpersonatorRef | undefined => {
	if (!user || typeof user !== 'object') {
		return undefined
	}
	const impersonator = (user as { _impersonation?: { impersonator?: unknown } })._impersonation
		?.impersonator
	if (!impersonator || typeof impersonator !== 'object') {
		return undefined
	}
	const { collection, id } = impersonator as { collection?: unknown; id?: unknown }
	if (typeof collection !== 'string' || collection.length === 0) {
		return undefined
	}
	if (typeof id !== 'string' && typeof id !== 'number') {
		return undefined
	}
	return { collection, id }
}
