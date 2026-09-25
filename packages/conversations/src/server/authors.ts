import type { PayloadRequest } from 'payload'

import type { AuthorsMap, ConversationMessage, ConversationsInstance } from '../types'
import { loadUsers } from './audience'

export const DELETED_USER = 'Deleted user'

/**
 * Users as the UI shows them, by user key, through each users collection's
 * `display`. A missing document reads as a deleted user. Extensions use it
 * to name the people in their own data (who reacted, who read).
 */
export const projectUsers = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	userKeys: Iterable<string>
): Promise<AuthorsMap> => {
	const keys = new Set(userKeys)
	const users = await loadUsers(req, instance, keys)
	const displays = new Map(instance.users.map((entry) => [entry.collection, entry.display]))
	const projected: AuthorsMap = {}
	for (const key of keys) {
		const doc = users.get(key)
		const display = doc ? displays.get(doc.collection) : undefined
		if (!doc || !display) {
			projected[key] = { deleted: true, name: DELETED_USER }
			continue
		}
		const shown = display(doc)
		projected[key] = { avatar: shown.avatar ?? null, name: shown.name }
	}
	return projected
}

/**
 * The `authors` map of a response: every author and mentioned user of the
 * given messages, projected once per response.
 */
export const projectAuthors = (
	req: PayloadRequest,
	instance: ConversationsInstance,
	messages: ConversationMessage[]
): Promise<AuthorsMap> =>
	projectUsers(
		req,
		instance,
		messages.flatMap((message) => [message.authorKey, ...(message.mentions ?? [])])
	)
