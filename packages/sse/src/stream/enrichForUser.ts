import type { PayloadRequest } from 'payload'

import type { RealtimeEvent } from '../broker/types'

/**
 * Per-subscriber document enrichment. Uses the subscriber's `req` so Payload
 * access controls apply. Never sets `overrideAccess`. On deny/miss/throw,
 * returns the original thin event (list invalidation, no leak).
 */
export const enrichForUser = async (args: {
	event: RealtimeEvent
	collection: string
	docId: string
	req: PayloadRequest
}): Promise<RealtimeEvent> => {
	const { event, collection, docId, req } = args
	try {
		const doc = await req.payload.findByID({
			collection,
			id: docId,
			req,
			depth: 0,
			overrideAccess: false,
		})
		if (doc == null) return event
		const existing =
			typeof event.data === 'object' && event.data !== null
				? (event.data as Record<string, unknown>)
				: {}
		return { ...event, data: { ...existing, doc } }
	} catch {
		return event
	}
}
