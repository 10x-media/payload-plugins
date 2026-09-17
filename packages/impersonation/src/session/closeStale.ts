import type { CollectionSlug, Payload } from 'payload'

import { collectionBySlug } from '../ids'

import { getRegistry } from '../plugin/registry'
import type { EndedBy, ImpersonationRecord } from '../types'
import { closeAndRevoke } from './close'
import { isPastAbsoluteExpiry, relationOf } from './resolve'

const PAGE = 100

/**
 * Close open rows whose minted sid is gone, whose target is gone, or whose
 * optional absolute cap has passed. Safe to run from a cron or `onInit`.
 */
export const closeStaleImpersonations = async (payload: Payload): Promise<number> => {
	const options = getRegistry(payload.config)
	if (!options) {
		return 0
	}

	let closed = 0
	let lastId: number | string | undefined

	for (;;) {
		const open = await payload.find({
			collection: options.collectionSlug,
			depth: 0,
			limit: PAGE,
			overrideAccess: true,
			sort: 'id',
			where: {
				and: [
					{ endedAt: { exists: false } },
					...(lastId != null ? [{ id: { greater_than: lastId } }] : []),
				],
			},
		})

		if (open.docs.length === 0) {
			break
		}

		for (const doc of open.docs as unknown as ImpersonationRecord[]) {
			lastId = doc.id
			const reason = await staleReason(payload, doc)
			if (!reason) {
				continue
			}
			await closeAndRevoke({ endedBy: reason, options, payload, record: doc })
			closed += 1
		}

		if (open.docs.length < PAGE) {
			break
		}
	}

	return closed
}

const staleReason = async (
	payload: Payload,
	record: ImpersonationRecord
): Promise<EndedBy | null> => {
	if (isPastAbsoluteExpiry(record)) {
		return 'expired'
	}

	const target = relationOf(record.target)
	if (!target || !collectionBySlug(payload, target.collection)) {
		return 'targetGone'
	}

	try {
		const user = (await payload.db.findOne({
			collection: target.collection as CollectionSlug,
			where: { id: { equals: target.id } },
		})) as { sessions?: { id: string }[] } | null

		if (!user) {
			return 'targetGone'
		}

		if (!(user.sessions ?? []).some((session) => session.id === record.targetSid)) {
			return 'expired'
		}
	} catch (error) {
		payload.logger.error({
			err: error,
			msg: '@10x-media/impersonation: closeStale skipped a row after a target lookup error',
		})
		return null
	}

	return null
}
