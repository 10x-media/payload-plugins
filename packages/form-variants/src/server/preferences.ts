import type { PayloadRequest } from 'payload'

import { preferenceKeyFor } from '../plugin/constants'

/** The shape the switcher stores under `form-variants-<slug>`. */
export type StoredChoice = { variant?: string }

/**
 * The account's stored variant choice for one collection, read on the server so the page
 * opens on it rather than switching a moment later. Payload's own `payload-preferences`
 * collection, so it works on both database adapters and the plugin adds no storage.
 */
export const getStoredChoice = async (
	req: PayloadRequest,
	collectionSlug: string
): Promise<null | string> => {
	if (!req.user?.collection) {
		return null
	}
	const found = await req.payload.find({
		collection: 'payload-preferences',
		depth: 0,
		limit: 1,
		pagination: false,
		req,
		where: {
			and: [
				{ key: { equals: preferenceKeyFor(collectionSlug) } },
				{ 'user.relationTo': { equals: req.user.collection } },
				{ 'user.value': { equals: req.user.id } },
			],
		},
	})
	const value = found.docs[0]?.value as StoredChoice | undefined
	return typeof value?.variant === 'string' ? value.variant : null
}
