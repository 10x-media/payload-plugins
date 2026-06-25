import type { Payload } from 'payload'
import type { SipgateNewCallWebhookData } from './sipgateWebhookHandler'

export type StoredCall = SipgateNewCallWebhookData & {
	status: 'ringing' | 'active'
	held: boolean
	muted: boolean
	recording: boolean
	dtmf?: string
}

const KEY = '@10x-media/sipgate:active-call:'

const callKey = (callId: string, direction: string) => `${KEY}${callId}:${direction}`

const matchesCallId = (key: string, callId: string) => key.startsWith(`${KEY}${callId}:`)

export const createActiveCallStore = (payload: Payload, callId?: string) => {
	const requireCallId = (): string => {
		if (!callId) throw new Error('callId is required for this operation')
		return callId
	}

	return {
		get: async (): Promise<StoredCall[]> => {
			const allKeys = await payload.kv.keys()
			const values = await Promise.all(
				allKeys.filter((k) => k.startsWith(KEY)).map((k) => payload.kv.get<StoredCall>(k))
			)
			return values.filter((v): v is StoredCall => v !== null)
		},
		set: (call: StoredCall) => payload.kv.set(callKey(requireCallId(), call.direction), call),
		update: async (partial: Partial<StoredCall>) => {
			const id = requireCallId()
			const allKeys = await payload.kv.keys()
			const matching = allKeys.filter((k) => matchesCallId(k, id))
			await Promise.all(
				matching.map(async (k) => {
					const existing = await payload.kv.get<StoredCall>(k)
					if (existing) await payload.kv.set(k, { ...existing, ...partial })
				})
			)
		},
		getOne: async (): Promise<StoredCall | null> => {
			const id = requireCallId()
			const allKeys = await payload.kv.keys()
			const matching = allKeys.filter((k) => matchesCallId(k, id))
			for (const k of matching) {
				const v = await payload.kv.get<StoredCall>(k)
				if (v) return v
			}
			return null
		},
		clear: async () => {
			const id = requireCallId()
			const allKeys = await payload.kv.keys()
			const matching = allKeys.filter((k) => matchesCallId(k, id))
			await Promise.all(matching.map((k) => payload.kv.delete(k)))
		},
	}
}
