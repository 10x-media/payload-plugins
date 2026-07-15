import type { Payload } from 'payload'

/** A live call tracked in the KV store, fed by Wildix webhook events. */
export type StoredCall = {
	sipCallId: string
	callId: string
	from: string
	to: string
	direction: 'in' | 'out'
	userId?: string
	userExtension?: string
	status: 'ringing' | 'active'
	held: boolean
	startedAt?: number
	answeredAt?: number
}

const KEY = '@10x-media/wildix:active-call:'

const callKey = (callId: string) => `${KEY}${callId}`

const matchesCallId = (key: string, callId: string) => key === callKey(callId)

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
		set: (call: StoredCall) => payload.kv.set(callKey(requireCallId()), call),
		update: async (partial: Partial<StoredCall>) => {
			const id = requireCallId()
			const existing = await payload.kv.get<StoredCall>(callKey(id))
			if (existing) await payload.kv.set(callKey(id), { ...existing, ...partial })
		},
		getOne: async (): Promise<StoredCall | null> => {
			const id = requireCallId()
			return payload.kv.get<StoredCall>(callKey(id))
		},
		clear: async () => {
			const id = requireCallId()
			const allKeys = await payload.kv.keys()
			await Promise.all(
				allKeys.filter((k) => matchesCallId(k, id)).map((k) => payload.kv.delete(k))
			)
		},
	}
}
