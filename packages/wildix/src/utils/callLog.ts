import type { CollectionSlug, Payload } from 'payload'
import type { CallStatus, CallType } from '../types'

export type CallLogData = {
	callId: string
	callType: CallType
	callStatus: CallStatus
	callDuration: number
	fromNumber: string
	toNumber: string
	startedAt?: Date
	relatedContact?: { relationTo: string; value: string }
	/** Wildix PBX user id / extension owning this log. Populated in OAuth2 sync. */
	wildixUserId?: string
}

export const createOrUpdateCallLog = async (
	payload: Payload,
	callLogsSlug: string,
	data: CallLogData
) => {
	const existing = await payload.find({
		collection: callLogsSlug as CollectionSlug,
		where: { callId: { equals: data.callId } },
		limit: 1,
		overrideAccess: true,
	})
	if (existing.totalDocs > 0) {
		const existingDoc = existing.docs[0] as { id: string } | undefined
		if (!existingDoc)
			return payload.create({
				collection: callLogsSlug as CollectionSlug,
				data: data as never,
				overrideAccess: true,
			})
		return payload.update({
			collection: callLogsSlug as CollectionSlug,
			id: existingDoc.id,
			data: data as never,
			overrideAccess: true,
		})
	}
	return payload.create({
		collection: callLogsSlug as CollectionSlug,
		data: data as never,
		overrideAccess: true,
	})
}
