import type { PayloadHandler } from 'payload'
import { createActiveCallStore } from './activeCall'

export const sipgateActiveCallHandler: PayloadHandler = async (req) => {
	const activeCall = await createActiveCallStore(req.payload).get()
	if (!activeCall) {
		return Response.json({ error: 'Call not found' }, { status: 404 })
	}

	return Response.json(activeCall, { status: 200 })
}
