import type { CollectionSlug, Payload, PayloadRequest } from 'payload'

import { revokeSession } from '../auth/revoke'
import type { EndedBy, ImpersonationRecord, ResolvedOptions } from '../types'
import { relationOf } from './resolve'

export const closeRecord = async ({
	endedBy,
	options,
	payload,
	record,
	req,
}: {
	endedBy: EndedBy
	options: ResolvedOptions
	payload: Payload
	record: ImpersonationRecord
	req?: PayloadRequest
}): Promise<ImpersonationRecord> => {
	if (record.endedAt) {
		return record
	}

	const updated = (await payload.update({
		id: record.id,
		collection: options.collectionSlug,
		data: { endedAt: new Date().toISOString(), endedBy } as never,
		depth: 0,
		overrideAccess: true,
		req,
	})) as unknown as ImpersonationRecord

	await options.onEnd?.({ endedBy, payload, record: updated, req })
	return updated
}

export const closeAndRevoke = async ({
	endedBy,
	options,
	payload,
	record,
	req,
}: {
	endedBy: EndedBy
	options: ResolvedOptions
	payload: Payload
	record: ImpersonationRecord
	req?: PayloadRequest
}): Promise<ImpersonationRecord> => {
	const target = relationOf(record.target)
	if (target) {
		const revoke = options.session.revoke ?? revokeSession
		await revoke({
			collection: target.collection as CollectionSlug,
			payload,
			req,
			sid: record.targetSid,
			userId: target.id,
		})
	}
	return closeRecord({ endedBy, options, payload, record, req })
}
