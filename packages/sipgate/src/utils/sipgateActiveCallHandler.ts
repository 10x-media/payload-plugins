import type { PayloadHandler } from 'payload'
import { createActiveCallStore } from './activeCall'

export const sipgateActiveCallHandler: PayloadHandler = async (req) => {
	if (!req.routeParams?.callId) {
		return Response.json({ error: 'Call ID is required' }, { status: 400 })
	}
	const activeCall = await createActiveCallStore(
		req.payload,
		req.routeParams.callId as string
	).get()
	if (!activeCall) {
		return Response.json({ error: 'Call not found' }, { status: 404 })
	}

	console.log('Active call:', activeCall)

	return Response.json(activeCall, { status: 200 })
}
