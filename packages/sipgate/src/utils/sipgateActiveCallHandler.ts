import type { PayloadHandler } from 'payload'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { createActiveCallStore } from './activeCall'

export const sipgateActiveCallHandler =
	(access?: SipgateAccess, sipgateUsersSlug?: string): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'activeCall')
		if (denied) return denied

		const allCalls = await createActiveCallStore(req.payload).get()

		// Filter to calls involving the current user's sipgate account when linked.
		let calls = allCalls
		if (sipgateUsersSlug && req.user?.id) {
			const linked = await req.payload.find({
				collection: sipgateUsersSlug,
				where: { 'payloadUser.value': { equals: req.user.id } },
				limit: 1,
				depth: 0,
				overrideAccess: true,
			})
			const sipgateUserId = linked.docs[0]?.id as string | undefined
			if (sipgateUserId) {
				calls = allCalls.filter((c) => {
					const userIds: string[] = (c['userId[]'] as string[] | undefined) ?? []
					return userIds.includes(sipgateUserId)
				})
			}
		}

		return Response.json(calls, { status: 200 })
	}
