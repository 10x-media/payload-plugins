import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PayloadHandler } from 'payload'
import type { CallStatus, WildixWebhookPayload } from '../types'
import { createActiveCallStore } from './activeCall'
import { createOrUpdateCallLog } from './callLog'

type WildixWebhookHandlerOptions = {
	callLogsSlug: string
	/** Shared secret configured in the WMS integration. When set, signatures are enforced. */
	webhookSecret?: string
}

/**
 * Validates the `x-signature` header against a SHA256 HMAC of the raw body.
 * Returns true when no secret is configured (dev), so unsigned local testing works.
 */
export const verifyWebhookSignature = (
	rawBody: string,
	signature: string | null,
	secret: string | undefined
): boolean => {
	if (!secret) return true
	if (!signature) return false
	const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
	const a = Buffer.from(expected)
	const b = Buffer.from(signature)
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}

const resolveDirection = (raw: string | undefined): 'in' | 'out' =>
	raw?.toLowerCase().startsWith('out') ? 'out' : 'in'

export const wildixWebhookHandler =
	({ callLogsSlug, webhookSecret }: WildixWebhookHandlerOptions): PayloadHandler =>
	async (req) => {
		if (req.method !== 'POST') {
			return Response.json({ error: 'Method not allowed' }, { status: 405 })
		}
		if (!req.text) {
			return Response.json({ error: 'No body' }, { status: 400 })
		}
		const rawBody = await req.text()

		const signature = req.headers?.get('x-signature') ?? req.headers?.get('X-Signature') ?? null
		if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
			return Response.json({ error: 'Invalid signature' }, { status: 401 })
		}

		let payload: WildixWebhookPayload
		try {
			payload = JSON.parse(rawBody) as WildixWebhookPayload
		} catch {
			return Response.json({ error: 'Invalid JSON' }, { status: 400 })
		}

		const data = payload.data ?? {}
		const callId = data.sipCallId ?? data.callId
		if (!callId) {
			return new Response(null, { status: 204 })
		}

		const store = createActiveCallStore(req.payload, callId)
		const direction = resolveDirection(data.direction)

		switch (payload.event) {
			case 'call:start':
				await store.set({
					sipCallId: data.sipCallId ?? callId,
					callId,
					from: data.from ?? '',
					to: data.to ?? '',
					direction,
					userId: data.userId,
					userExtension: data.userExtension,
					status: 'ringing',
					held: false,
					startedAt: data.startedAt ?? Date.now(),
				})
				return new Response(null, { status: 204 })

			case 'call:live:progress':
				return new Response(null, { status: 204 })

			case 'call:update':
				await store.update({ status: 'active', answeredAt: data.answeredAt ?? Date.now() })
				return new Response(null, { status: 204 })

			case 'call:completed': {
				const stored = await store.getOne()
				const callStatus: CallStatus = stored?.answeredAt != null ? 'completed' : 'missed'
				const callDuration =
					stored?.answeredAt != null
						? Math.max(0, Math.round((Date.now() - stored.answeredAt) / 1000))
						: 0

				await createOrUpdateCallLog(req.payload, callLogsSlug, {
					callId,
					callType: direction,
					callStatus,
					callDuration,
					fromNumber: data.from ?? stored?.from ?? '',
					toNumber: data.to ?? stored?.to ?? '',
					startedAt: stored?.startedAt != null ? new Date(stored.startedAt) : undefined,
					...(data.userId ? { wildixUserId: data.userId } : {}),
				}).catch((err) => {
					req.payload.logger.error('[wildix] Failed to write call log on completed:', err)
				})

				await store.clear()
				return new Response(null, { status: 204 })
			}

			default:
				return Response.json({ error: 'Invalid event' }, { status: 400 })
		}
	}
