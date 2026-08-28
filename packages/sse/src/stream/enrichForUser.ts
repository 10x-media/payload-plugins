import type { PayloadRequest } from 'payload'

import type { RealtimeEvent } from '../broker/types'

/**
 * Per-subscriber document enrichment. Uses the subscriber's `req` so Payload
 * access controls apply. Never sets `overrideAccess`.
 *
 * `onDeny: 'thin'` (default) returns the original event so list views can
 * invalidate. `onDeny: 'drop'` returns `null` so gated wide topics leak nothing.
 */
export const enrichForUser = async (args: {
	event: RealtimeEvent
	collection: string
	docId: string
	req: PayloadRequest
	onDeny?: 'thin' | 'drop'
}): Promise<RealtimeEvent | null> => {
	const { event, collection, docId, req, onDeny = 'thin' } = args
	const denied = (): RealtimeEvent | null => (onDeny === 'drop' ? null : event)
	try {
		const doc = await req.payload.findByID({
			collection,
			id: docId,
			req,
			depth: 0,
			overrideAccess: false,
		})
		if (doc == null) return denied()
		const existing =
			typeof event.data === 'object' && event.data !== null
				? (event.data as Record<string, unknown>)
				: {}
		return { ...event, data: { ...existing, doc } }
	} catch {
		return denied()
	}
}
