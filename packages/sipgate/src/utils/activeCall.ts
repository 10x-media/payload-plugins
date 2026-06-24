import type { Payload } from 'payload'
import type { SipgateNewCallWebhookData } from './sipgateWebhookHandler'

export type StoredCall = SipgateNewCallWebhookData & { status: 'ringing' | 'active' }

const KEY = '@10x-media/sipgate:active-call'
export const createActiveCallStore = (payload: Payload, callId?: string) => ({
	get: async (): Promise<StoredCall[]> => {
		const allKeys = await payload.kv.keys()
		const callKeys = allKeys.filter((k) => k.startsWith(KEY))
		const values = await Promise.all(callKeys.map((k) => payload.kv.get<StoredCall>(k)))
		return values.filter((v): v is StoredCall => v !== null)
	},
	set: (call: StoredCall) => payload.kv.set(`${KEY}${callId}`, call),
	update: async (partial: Partial<StoredCall>) => {
		const existing = await payload.kv.get<StoredCall>(`${KEY}${callId}`)
		if (!existing) return
		await payload.kv.set(`${KEY}${callId}`, { ...existing, ...partial })
	},
	clear: () => payload.kv.delete(`${KEY}${callId}`),
})
