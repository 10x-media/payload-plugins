import type { Payload } from 'payload'
import type { CallStatus } from '../types'

export type CallLogData = {
	callId: string
	callType: 'in' | 'out'
	callStatus: CallStatus
	callDuration: number
	fromNumber: string
	toNumber: string
	startedAt?: Date
	relatedContact?: { relationTo: string; value: string }
	/** Sipgate user ID (e.g. "w2") owning this log. Populated in OAuth2 sync. */
	sipgateUserId?: string
}

export const createOrUpdateCallLog = async (
	payload: Payload,
	callLogsSlug: string,
	data: CallLogData
) => {
	const existing = await payload.find({
		collection: callLogsSlug,
		where: { callId: { equals: data.callId } },
		limit: 1,
		overrideAccess: true,
	})
	if (existing.totalDocs > 0) {
		const existingDoc = existing.docs[0]
		if (!existingDoc)
			return payload.create({ collection: callLogsSlug, data, overrideAccess: true })
		return payload.update({
			collection: callLogsSlug,
			id: existingDoc.id as string,
			data,
			overrideAccess: true,
		})
	}
	return payload.create({
		// biome-ignore lint/suspicious/noExplicitAny: dynamic collection slug from plugin config
		collection: callLogsSlug as any,
		data,
		overrideAccess: true,
	})
}
