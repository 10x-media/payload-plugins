import type { Payload, PayloadRequest } from 'payload'

import { collectionBySlug } from '../ids'
import type { ImpersonationRecord } from '../types'
import { relationOf } from './resolve'

const LOCKS = 'payload-locked-documents'

export const releaseLocks = async ({
	payload,
	record,
	req,
}: {
	payload: Payload
	record: ImpersonationRecord
	req?: PayloadRequest
}): Promise<void> => {
	if (!collectionBySlug(payload, LOCKS)) {
		return
	}

	const target = relationOf(record.target)
	if (!target) {
		return
	}

	const endedAt = record.endedAt ?? new Date().toISOString()

	try {
		await payload.delete({
			collection: LOCKS,
			overrideAccess: true,
			req,
			where: {
				and: [
					{ 'user.relationTo': { equals: target.collection } },
					{ 'user.value': { equals: target.id } },
					{ createdAt: { greater_than_equal: record.startedAt } },
					{ createdAt: { less_than_equal: endedAt } },
				],
			},
		})
	} catch {
		// Adapter query shape for the polymorphic user field differs; a miss is not fatal.
	}
}
