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

	const endedAt = new Date().toISOString()
	let updated: ImpersonationRecord
	try {
		updated = (await payload.update({
			id: record.id,
			collection: options.collectionSlug,
			data: { endedAt, endedBy } as never,
			depth: 0,
			overrideAccess: true,
			req,
		})) as unknown as ImpersonationRecord
	} catch {
		// Postgres CASCADE-deletes impersonation_sessions_rels when the
		// impersonator or target user is deleted. payload.update then fails
		// required-relationship validation. Close through the adapter instead.
		await payload.db.updateOne({
			id: record.id,
			collection: options.collectionSlug,
			data: { endedAt, endedBy },
			req,
			returning: false,
		})
		updated = { ...record, endedAt, endedBy }
	}

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
