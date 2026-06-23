import type { CollectionSlug, PayloadHandler } from 'payload'

export const sipgateWebhookHandler =
	(contactCollections: CollectionSlug[], phoneNumberFields: string[]): PayloadHandler =>
	(req) => {
		const body = req.body
		console.log(body)
		console.log(contactCollections)
		console.log(phoneNumberFields)
		return Response.json({ received: true }, { status: 200 })
	}
