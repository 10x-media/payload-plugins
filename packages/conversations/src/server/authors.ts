import type { PayloadRequest } from 'payload'

import type { AuthorsMap, ConversationMessage, ConversationsInstance } from '../types'
import { loadUsers } from './audience'

export const DELETED_USER = 'Deleted user'

/**
 * The `authors` map of a response: every author and mentioned user of the
 * given messages, projected once per response through the users collection's
 * `display`. A missing document reads as a deleted user.
 */
export const projectAuthors = async (
	req: PayloadRequest,
	instance: ConversationsInstance,
	messages: ConversationMessage[]
): Promise<AuthorsMap> => {
	const keys = new Set<string>()
	for (const message of messages) {
		keys.add(message.authorKey)
		for (const mentioned of message.mentions ?? []) {
			keys.add(mentioned)
		}
	}
	const users = await loadUsers(req, instance, keys)
	const displays = new Map(instance.users.map((entry) => [entry.collection, entry.display]))
	const authors: AuthorsMap = {}
	for (const key of keys) {
		const doc = users.get(key)
		const display = doc ? displays.get(doc.collection) : undefined
		if (!doc || !display) {
			authors[key] = { deleted: true, name: DELETED_USER }
			continue
		}
		const projected = display(doc)
		authors[key] = { avatar: projected.avatar ?? null, name: projected.name }
	}
	return authors
}
