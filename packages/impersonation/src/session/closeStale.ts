import type { CollectionSlug, Payload } from 'payload'

import { collectionBySlug } from '../ids'

import { getRegistry } from '../plugin/registry'
import type { ImpersonationRecord, ResolvedOptions } from '../types'
import { closeAndRevoke } from './close'
import { isPastAbsoluteExpiry, relationOf } from './resolve'

/**
 * Close open rows whose minted sid is gone, whose target is gone, or whose
 * optional absolute cap has passed. Safe to run from a cron or `onInit`.
 */
export const closeStaleImpersonations = async (payload: Payload): Promise<number> => {
	const options = getRegistry(payload.config)
	if (!options) {
		return 0
	}

	const open = await payload.find({
		collection: options.collectionSlug,
		depth: 0,
		limit: 1000,
		overrideAccess: true,
		pagination: false,
		where: { endedAt: { exists: false } },
	})

	let closed = 0
	for (const doc of open.docs as unknown as ImpersonationRecord[]) {
		const reason = await staleReason(payload, options, doc)
		if (!reason) {
			continue
		}
		await closeAndRevoke({ endedBy: reason, options, payload, record: doc })
		closed += 1
	}

	return closed
}

const staleReason = async (
	payload: Payload,
	_options: ResolvedOptions,
	record: ImpersonationRecord
) => {
	if (isPastAbsoluteExpiry(record)) {
		return 'expired' as const
	}

	const target = relationOf(record.target)
	if (!target || !collectionBySlug(payload, target.collection)) {
		return 'targetGone' as const
	}

	try {
		const user = (await payload.db.findOne({
			collection: target.collection as CollectionSlug,
			where: { id: { equals: target.id } },
		})) as { sessions?: { id: string }[] } | null

		if (!user) {
			return 'targetGone' as const
		}

		if (!(user.sessions ?? []).some((session) => session.id === record.targetSid)) {
			return 'expired' as const
		}
	} catch {
		return 'failed' as const
	}

	return null
}
