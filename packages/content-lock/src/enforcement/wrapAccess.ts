import type { Access, AccessArgs, AccessResult } from 'payload'

import { isEntityLocked } from '../state/resolve'
import type { EntityRef } from '../state/types'
import { readStateOrLocked } from './assertUnlocked'

/** Property on a wrapped access function pointing at the function it wraps. */
export const ORIGINAL_ACCESS = Symbol.for('@10x-media/content-lock:originalAccess')

export type WrappedAccess = Access & { [ORIGINAL_ACCESS]?: Access }

/** Payload's own default when a collection or global declares no access function. */
const defaultAccess: Access = ({ req }) => Boolean(req.user)

/**
 * Deny a write operation while `entity` is frozen, so the admin renders the
 * document read-only. Otherwise defer to the original, returning its boolean
 * or `Where` untouched. The original stays reachable through `ORIGINAL_ACCESS`
 * for tools that introspect access functions.
 */
export const wrapAccess = (original: Access | undefined, entity: EntityRef): WrappedAccess => {
	const base = original ?? defaultAccess
	const wrapped: WrappedAccess = async (args: AccessArgs): Promise<AccessResult> => {
		const state = await readStateOrLocked(args.req)
		if (isEntityLocked(state, entity)) {
			return false
		}
		return base(args)
	}
	Object.defineProperty(wrapped, ORIGINAL_ACCESS, { enumerable: false, value: original })
	return wrapped
}
