import type { PayloadHandler } from 'payload'
import { env } from '../env'
import { createActiveCallStore } from './activeCall'
import { createOrUpdateCallLog } from './callLog'
import { createIvrStore } from './ivrStore'
import { parseFormBody } from './parseFormBody'
import { buildStepAction, findFlowForNumber, resolveVoiceLineUrl } from './sipgateIvrHandler'
import { xmlResponse } from './xmlFactory'

export type IvrOptions = {
	flowsSlug: string
	ivrEndpointUrl: string
}

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

const HANGUP_CAUSE_STATUS: Record<string, 'completed' | 'missed' | 'rejected'> = {
	normalClearing: 'completed',
	busy: 'missed',
	cancel: 'missed',
	noAnswer: 'missed',
	congestion: 'missed',
	notFound: 'missed',
	forwarded: 'completed',
}

type SipgateWebhookHandlerOptions = {
	callLogsSlug: string
	ivr?: IvrOptions
	/**
	 * Public base URL of the Payload instance. When set, `onAnswer`/`onHangup`
	 * callbacks point at `${webhookUrl}/api/sipgate/webhooks`. Falls back to the
	 * `SIPGATE_WEBHOOK_URL` env var for backwards compatibility.
	 */
	webhookUrl?: string
}

export const sipgateWebhookHandler =
	({ callLogsSlug, ivr, webhookUrl }: SipgateWebhookHandlerOptions): PayloadHandler =>
	async (req) => {
		if (!req.text) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const body = await req.text()

		if (req.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}

		const data = parseFormBody(body) as unknown as
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
					startedAt: Date.now(),
				})
				const callbackUrl = webhookUrl
					? `${webhookUrl}/api/sipgate/webhooks`
					: env.SIPGATE_WEBHOOK_URL
				if (!callbackUrl) {
					return new Response(null, { status: 204 })
				}
				return xmlResponse({ onAnswer: callbackUrl, onHangup: callbackUrl })
			}
			case 'dtmf':
				await createActiveCallStore(req.payload, data.callId).update({ dtmf: data.dtmf })
				return new Response(null, { status: 204 })
			case 'answer': {
				await createActiveCallStore(req.payload, data.callId).update({
					status: 'active',
					answeredAt: Date.now(),
				})

				if (ivr) {
					const flow = await findFlowForNumber(req.payload, ivr.flowsSlug, data.to)
					if (flow) {
						const entryStep = flow.steps.find((s) => s.stepId === flow.entryStepId)
						if (entryStep) {
							const voiceLineUrl = resolveVoiceLineUrl(entryStep)
							if (voiceLineUrl) {
								await createIvrStore(req.payload, data.callId).set({
									flowId: flow.id,
									stepId: flow.entryStepId,
								})
								return xmlResponse({
									action: buildStepAction(entryStep, voiceLineUrl, ivr.ivrEndpointUrl),
								})
							}
						}
					}
				}

				return new Response(null, { status: 204 })
			}
			case 'hangup': {
				const store = createActiveCallStore(req.payload, data.callId)
				const stored = await store.getOne()

				const callStatus = HANGUP_CAUSE_STATUS[data.cause] ?? 'completed'
				const callDuration =
					stored?.answeredAt != null
						? Math.max(0, Math.round((Date.now() - stored.answeredAt) / 1000))
						: 0

				await createOrUpdateCallLog(req.payload, callLogsSlug, {
					callId: data.callId,
					callType: data.direction,
					callStatus,
					callDuration,
					fromNumber: data.from,
					toNumber: data.to,
					startedAt: stored?.startedAt != null ? new Date(stored.startedAt) : undefined,
				}).catch((err) => {
					console.error('[sipgate] Failed to write call log on hangup:', err)
				})

				await store.clear()
				await createIvrStore(req.payload, data.callId).clear()
				return new Response(null, { status: 204 })
			}
			default:
				return Response.json({ error: 'Invalid event' }, { status: 400 })
		}
	}
