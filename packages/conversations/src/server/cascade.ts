import type { CollectionAfterDeleteHook } from 'payload'

import { collectionKey } from '../shared/keys'
import type { ConversationsInstance } from '../types'

/**
 * Removes a deleted document's conversation. The built-in cascade is one
 * `deleteMany` per collection with no per-row hooks; a function in
 * `deleteWithTarget` replaces it, for a host that wants its own batch job.
 */
export const cascadeHook =
	(instance: ConversationsInstance, collection: string): CollectionAfterDeleteHook =>
	async ({ id, req }) => {
		const setting = instance.deleteWithTarget
		if (setting === false) {
			return
		}
		const key = collectionKey(collection, id)
		if (typeof setting === 'function') {
			await setting({ instance: instance.slug, key, req })
			return
		}
		// First, while the messages are there: an extension may read its fields on them.
		for (const extension of instance.extensionList) {
			await extension.onTargetDelete?.({ instance, key, req })
		}
		await req.payload.db.deleteMany({
			collection: instance.messagesSlug,
			req,
			where: { key: { equals: key } },
		})
		if (instance.readsSlug) {
			await req.payload.db.deleteMany({
				collection: instance.readsSlug,
				req,
				where: { key: { equals: key } },
			})
		}
	}
