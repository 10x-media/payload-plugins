import type { PayloadHandler } from 'payload'
import type { SipgateCredentials } from '../types'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { buildSipgateRest, Dial } from './sipgate.rest'

type CreateSipgateDialHandlerOptions = {
	credentials: SipgateCredentials
	access?: SipgateAccess
	singleUserEmail?: string
	sipgateUsersSlug?: string
}

export const createSipgateDialHandler =
	({
		credentials,
		access,
		singleUserEmail,
		sipgateUsersSlug,
	}: CreateSipgateDialHandlerOptions): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'dial')
		if (denied) return denied

		if (!req.json) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const { callee, deviceId: bodyDeviceId } = await req.json()
		if (!callee) {
			return Response.json({ error: 'callee is required' }, { status: 400 })
		}

		let deviceId: string | undefined = bodyDeviceId ?? credentials.deviceId

		if (!deviceId && singleUserEmail && sipgateUsersSlug) {
			const result = await req.payload.find({
				collection: sipgateUsersSlug,
				where: { email: { equals: singleUserEmail } },
				limit: 1,
				overrideAccess: true,
			})
			const user = result.docs[0]
			deviceId = user?.defaultDevice as string | undefined
		}

		if (!deviceId) {
			return Response.json({ error: 'deviceId not configured' }, { status: 500 })
		}

		const rest = buildSipgateRest(credentials)
		const response = await Dial(rest, {
			callee,
			caller: deviceId,
			callerId: credentials.callerId ?? deviceId,
			deviceId,
			channelId: credentials.channelId,
		})

		if (!response.ok) {
			const text = await response.text()
			return Response.json({ error: 'Failed to dial', detail: text }, { status: response.status })
		}
		return Response.json({ success: true }, { status: 200 })
	}
