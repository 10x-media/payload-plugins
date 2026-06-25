import type { CollectionSlug, PayloadHandler } from 'payload'
import queryString from 'query-string'
import { env } from '../env'
import { createActiveCallStore } from './activeCall'
import { xmlResponse } from './xmlFactory'

export type SipgateNewCallWebhookData = {
	event: 'newCall'
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

type SipgateDtmfWebhookData = {
	event: 'dtmf'
	callId: string
	dtmf: string
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
			| SipgateDtmfWebhookData

		switch (data.event) {
			case 'newCall': {
				await createActiveCallStore(req.payload, data.callId).set({
					...data,
					status: 'ringing',
					held: false,
					muted: false,
					recording: false,
				})
				if (!env.SIPGATE_WEBHOOK_URL) {
					return new Response(null, { status: 204 })
				}
				return xmlResponse({ onAnswer: env.SIPGATE_WEBHOOK_URL, onHangup: env.SIPGATE_WEBHOOK_URL })
			}
			case 'dtmf':
				await createActiveCallStore(req.payload, data.callId).update({ dtmf: data.dtmf })
				return new Response(null, { status: 204 })
			case 'answer':
				await createActiveCallStore(req.payload, data.callId).update({ status: 'active' })
				return new Response(null, { status: 204 })
			case 'hangup':
				await createActiveCallStore(req.payload, data.callId).clear()
				return new Response(null, { status: 204 })
			default:
				return Response.json({ error: 'Invalid event' }, { status: 400 })
		}
	}
