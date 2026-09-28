import type { PayloadRequest } from 'payload'

import { parseSystemKey } from '../shared/keys'
import type {
	AuthorProjection,
	AuthorsMap,
	ConversationMessage,
	ConversationsInstance,
	LocalizedLabel,
} from '../types'
import { loadUsers } from './audience'

export const DELETED_USER = 'Deleted user'

/** The name of a system author with no `systemAuthors` entry. */
export const SYSTEM_NAME = 'System'

const localized = (label: LocalizedLabel, locale: string | undefined): string =>
	typeof label === 'string'
		? label
		: ((locale ? label[locale] : undefined) ?? label.en ?? Object.values(label)[0] ?? SYSTEM_NAME)

/** A system author as the UI shows it: its configured name and avatar, or "System". */
const projectSystem = (
	req: PayloadRequest,
	instance: ConversationsInstance,
	name: string
): AuthorProjection => {
	const entry = instance.systemAuthors[name]
	return {
		avatar: entry?.avatar ?? null,
		name: entry ? localized(entry.name, req.i18n?.language) : SYSTEM_NAME,
		system: true,
	}
}

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
	const users = await loadUsers(req, instance, { userKeys: keys })
	const displays = new Map(instance.users.map((entry) => [entry.collection, entry.display]))
	const projected: AuthorsMap = {}
	for (const key of keys) {
		const system = parseSystemKey(key)
		if (system !== null) {
			projected[key] = projectSystem(req, instance, system)
			continue
		}
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
