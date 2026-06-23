import type { Payload } from 'payload'

const KEY = '@10x-media/sipgate:active-call'

export type ActiveCall = {
	callId: string
	from: string
	to: string
	contactId?: string
	contactCollection?: string
	contactName?: string
	startedAt: string
}

export const createActiveCallStore = (payload: Payload) => ({
	get: () => payload.kv.get<ActiveCall>(KEY),
	set: (call: ActiveCall) => payload.kv.set(KEY, call),
	clear: () => payload.kv.delete(KEY),
})
