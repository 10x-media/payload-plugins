import { APIError, type CollectionBeforeChangeHook } from 'payload'

import type { OwnerUser, SubscriptionOwnership } from '../options'
import { actingReq, canActAsOwner, canReadCollection, resolveOwner, sameOwner } from './owner'
import { rowInfo } from './resolveSubscriptions'

/**
 * Reject a subscription save that would give it something its owner may not have: an owner the
 * caller may not name, or an event from a collection the owner cannot read.
 *
 * A collection hook rather than field validation, so REST, GraphQL and the Local API are all
 * covered and `overrideAccess` does not skip it. It runs after every other collection-level
 * `beforeChange` hook, so it sees an owner stamped in `beforeValidate` or in a collection
 * `beforeChange`. Field-level `beforeChange` hooks run later still, and an owner stamped there
 * is not seen: the save is refused as having none.
 *
 * It judges what the save changes. A create is judged whole. On an update, whether the caller
 * may *name* the owner is asked only when the save changes who that is, and only events the row
 * did not already hold are checked against the owner's access. So an operator can switch a
 * tenant's subscription off without claiming to be the tenant, and a subscription whose owner
 * has since been deleted, or has lost access, can still be switched off, renamed or have its
 * secret rotated. Nothing is given away by that: what such a row may receive is decided again,
 * per document, every time it would fire.
 *
 * The checks read other collections' committed state, so they stay out of this write's
 * transaction.
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
		const stored = operation === 'update' && originalDoc ? rowInfo(originalDoc) : null
		const owner = await resolveOwner({ ownership, subscription, req: checkReq })
		const previous = stored
			? await resolveOwner({ ownership, subscription: stored, req: checkReq })
			: null
		const sameOwnerAsStored = stored !== null && sameOwner(previous, owner)
		if (!owner) {
			// It had no owner before this save either, so it could not deliver and still cannot.
			if (sameOwnerAsStored) {
				return data
			}
			throw new APIError(
				'This subscription has no owner, so it cannot be saved while enforceOwnerAccess is on.',
				403
			)
		}
		if (
			!sameOwnerAsStored &&
			!(await canActAsOwner({
				ownership,
				owner,
				req: checkReq,
				// Server code, not merely a request without a user: an anonymous REST call has none either.
				trusted: !req.user && req.payloadAPI === 'local',
			}))
		) {
			throw new APIError('You may not save a subscription that acts as this owner.', 403)
		}
		if (owner.global) {
			return data
		}
		// Under a new owner every event is new to them. Under the same one, only what this save adds.
		const held = new Set(sameOwnerAsStored && stored ? stored.events : [])
		const checked = new Set<string>()
		for (const event of subscription.events) {
			const slug = args.eventSources[event]
			if (!slug || held.has(event) || checked.has(slug)) {
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
