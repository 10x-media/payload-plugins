import type { PayloadRequest } from 'payload'
import { cache } from 'react'

import { PREFERENCE_KEY } from '../plugin/constants'

/** Which rail groups this reader has collapsed, keyed by overlay id and then by group label. */
export type GroupPrefs = {
	[overlayId: string]: { groups?: Record<string, { open?: boolean }> }
}

/**
 * The reader's collapsed groups, read once per render.
 *
 * Read on the server so the rail arrives in the state the reader left it, rather than opening
 * every group and collapsing them a moment later once a client fetch resolves.
 *
 * The key is the plugin's own, not Payload's `nav`: group labels repeat across surfaces, and a
 * panel group called "Content" must not collapse the sidebar's group of the same name.
 */
export const getGroupPrefs = cache(
	async (req: PayloadRequest | undefined): Promise<GroupPrefs | null> => {
		if (!req?.user?.collection) {
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
					{ key: { equals: PREFERENCE_KEY } },
					{ 'user.relationTo': { equals: req.user.collection } },
					{ 'user.value': { equals: req.user.id } },
				],
			},
		})

		return (found?.docs?.[0]?.value as GroupPrefs | undefined) ?? null
	}
)
