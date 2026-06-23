import type { CollectionSlug, PayloadHandler } from 'payload'
import { createActiveCallStore } from './activeCall'

export const sipgateActiveCallHandler =
	(contactCollections: CollectionSlug[], phoneNumberFields: string[]): PayloadHandler =>
	(req) => {
		const activeCall = createActiveCallStore(req.payload).get()
		return Response.json(activeCall, { status: 200 })
	}
