import type { CollectionSlug, PayloadRequest } from 'payload'

import type { SessionRevokeArgs } from '../types'

type SessionEntry = { id: string }

export const revokeSession = async ({
	collection,
	payload,
	req,
	sid,
	userId,
}: SessionRevokeArgs): Promise<void> => {
	const raw = (await payload.db.findOne({
		collection: collection as CollectionSlug,
		req,
		where: { id: { equals: userId } },
	})) as { id: number | string; sessions?: SessionEntry[] } | null

	if (!raw?.sessions?.length) {
		return
	}

	const sessions = raw.sessions.filter((session) => session.id !== sid)
	await payload.db.updateOne({
		id: raw.id,
		collection: collection as CollectionSlug,
		data: { ...raw, sessions, updatedAt: null },
		req: req as PayloadRequest,
		returning: false,
	})
}
