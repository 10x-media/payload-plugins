import type { Payload } from 'payload'
import type { SipgateNewCallWebhookData } from '../types'

const KEY = '@10x-media/sipgate:active-call'
export const createActiveCallStore = (payload: Payload, callId: string) => ({
	get: async (): Promise<SipgateNewCallWebhookData[]> => {
		const allKeys = await payload.kv.keys()
		const callKeys = allKeys.filter((k) => k.startsWith(KEY))
		const values = await Promise.all(
			callKeys.map((k) => payload.kv.get<SipgateNewCallWebhookData>(k))
		)
		return values.filter((v): v is SipgateNewCallWebhookData => v !== null)
	},
	set: (call: SipgateNewCallWebhookData) => payload.kv.set(`${KEY}${callId}`, call),
	clear: () => payload.kv.delete(`${KEY}${callId}`),
})
