import type { PayloadHandler } from 'payload'
import type { SipgateAccess } from './access'
import { checkAccess } from './access'
import { createActiveCallStore } from './activeCall'

export const sipgateActiveCallHandler =
	(access?: SipgateAccess): PayloadHandler =>
	async (req) => {
		const denied = await checkAccess(req, access, 'activeCall')
		if (denied) return denied

		const activeCall = await createActiveCallStore(req.payload).get()
		if (!activeCall) {
			return Response.json({ error: 'Call not found' }, { status: 404 })
		}
		return Response.json(activeCall, { status: 200 })
	}
