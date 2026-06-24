import type { CollectionSlug, PayloadHandler } from 'payload'
import queryString from 'query-string'
import { createActiveCallStore } from './activeCall'

export type SipgateNewCallWebhookData = {
	event: 'newcall'
	from: string
	to: string
	direction: 'in' | 'out'
	callId: string
	origCallId: string
	'user[]': string[]
	'userId[]': string[]
	'fullUserId[]': string[]
	xcid: string
}

type SipgateAnswerWebhookData = {
	event: 'answer'
	from: string
	to: string
	direction: 'in' | 'out'
	callId: string
	user: string
	userId: string
	fullUserId: string
	answeringNumber: string
}

type SipgateHangupWebhookData = {
	event: 'hangup'
	cause: 'normalClearing' | 'busy' | 'cancel' | 'noAnswer' | 'congestion' | 'notFound' | 'forwarded'
	callId: string
	from: string
	to: string
	direction: 'in' | 'out'
	answeringNumber: string
}

export const sipgateWebhookHandler =
	(_contactCollections: CollectionSlug[], _phoneNumberFields: string[]): PayloadHandler =>
	async (req) => {
		if (!req.text) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const body = await req.text()

		if (req.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}

		const data = queryString.parse(body) as
			| SipgateNewCallWebhookData
			| SipgateAnswerWebhookData
			| SipgateHangupWebhookData

		switch (data.event) {
			case 'newcall':
				await createActiveCallStore(req.payload, data.callId).set({ ...data, status: 'ringing' })
				break
			case 'answer':
				await createActiveCallStore(req.payload, data.callId).update({ status: 'active' })
				break
			case 'hangup':
				await createActiveCallStore(req.payload, data.callId).clear()
				break
			default:
				return Response.json({ error: 'Invalid event' }, { status: 400 })
		}

		return Response.json({ received: true }, { status: 200 })
	}
