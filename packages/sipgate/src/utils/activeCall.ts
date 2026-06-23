import type { Payload } from 'payload'
import type { SipgateNewCallWebhookData } from '../types'

const KEY = '@10x-media/sipgate:active-call'

export const createActiveCallStore = (payload: Payload, callId: string) => ({
	get: async () => {
		const data = await payload.kv.get(KEY + callId)
		return data ? (JSON.parse(data as string) as SipgateNewCallWebhookData) : null
	},
	set: (call: string) => payload.kv.set(KEY + callId, call),
	clear: () => payload.kv.delete(KEY + callId),
})
