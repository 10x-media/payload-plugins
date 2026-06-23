import type { PayloadHandler } from 'payload'

export const sipgateWebhookHandler: PayloadHandler = (req) => {
	const body = req.body
	console.log(body)
	return Response.json({ received: true }, { status: 200 })
}
