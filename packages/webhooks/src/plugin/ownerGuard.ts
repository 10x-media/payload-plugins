import { APIError, type CollectionBeforeChangeHook } from 'payload'

import type { OwnerUser, SubscriptionOwnership } from '../options'
import { actingReq, canActAsOwner, canReadCollection, resolveOwner, sameOwner } from './owner'
import { rowInfo } from './resolveSubscriptions'

/**
 * Reject a subscription save its owner may not make: one that acts as nobody, one whose caller
 * may not name that owner, or one that listens to a collection the owner cannot read.
 *
 * A collection hook rather than field validation, so REST, GraphQL and the Local API are all
 * covered and `overrideAccess` does not skip it. It runs last among the `beforeChange` hooks, so
 * it judges the row as it will be stored, after an application hook has stamped its owner.
 *
 * The owner is asked about on every save, but whether the caller may *name* that owner only on
 * create or when the save changes who it is: an operator switching a tenant's subscription off is
 * not claiming to be the tenant. The checks read other collections' committed state, so they stay
 * out of this write's transaction.
 */
export const makeOwnerGuard =
	(args: {
		ownership: SubscriptionOwnership
		/** Event id to the slug of the collection that emits it. */
		eventSources: Record<string, string>
	}): CollectionBeforeChangeHook =>
	async ({ data, operation, originalDoc, req }) => {
		const { ownership } = args
		const checkReq = await actingReq(req, {
			detached: true,
			user: req.user as OwnerUser | null,
		})
		const subscription = rowInfo({ ...(originalDoc ?? {}), ...data })
		const owner = await resolveOwner({ ownership, subscription, req: checkReq })
		if (!owner) {
			throw new APIError(
				'This subscription has no owner, so it cannot be saved while enforceOwnerAccess is on.',
				403
			)
		}
		const previous =
			operation === 'update' && originalDoc
				? await resolveOwner({ ownership, subscription: rowInfo(originalDoc), req: checkReq })
				: null
		if (
			(operation === 'create' || !sameOwner(previous, owner)) &&
			!(await canActAsOwner({ ownership, owner, req: checkReq }))
		) {
			throw new APIError('You may not save a subscription that acts as this owner.', 403)
		}
		if (owner.global) {
			return data
		}
		const checked = new Set<string>()
		for (const event of subscription.events) {
			const slug = args.eventSources[event]
			if (!slug || checked.has(slug)) {
				continue
			}
			checked.add(slug)
			if (!(await canReadCollection({ req, collection: slug, user: owner.user }))) {
				throw new APIError(
					`The subscription owner cannot read '${slug}', so it cannot subscribe to ${event}.`,
					403
				)
			}
		}
		return data
	}
