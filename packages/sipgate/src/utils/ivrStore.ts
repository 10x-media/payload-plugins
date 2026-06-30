import type { Payload } from 'payload'

export type IvrSession = {
	flowId: string
	stepId: string
}

const KEY_PREFIX = '@10x-media/sipgate:ivr:'

const sessionKey = (callId: string) => `${KEY_PREFIX}${callId}`

export const createIvrStore = (payload: Payload, callId: string) => ({
	set: (session: IvrSession) => payload.kv.set(sessionKey(callId), session),
	get: () => payload.kv.get<IvrSession>(sessionKey(callId)),
	update: async (partial: Partial<IvrSession>) => {
		const existing = await payload.kv.get<IvrSession>(sessionKey(callId))
		if (existing) {
			await payload.kv.set(sessionKey(callId), { ...existing, ...partial })
		}
	},
	clear: () => payload.kv.delete(sessionKey(callId)),
})
