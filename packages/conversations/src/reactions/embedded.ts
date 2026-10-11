/** One reaction as `storage: 'message'` keeps it in the message's `reactions` field. */
export type StoredReaction = { at: string; emoji: string; userKey: string }

/** What an add or a remove did: the list to store, and what really changed. */
export type ReactionChange = {
	/** The emoji really added, if any. */
	added: null | string
	next: StoredReaction[]
	/** The viewer's emoji really removed: the one asked for, or those a `replace` pushed out. */
	removed: string[]
}

/** The stored list, dropping anything that is not a reaction. */
export const readStored = (value: unknown): StoredReaction[] =>
	Array.isArray(value)
		? value.filter(
				(entry): entry is StoredReaction =>
					typeof entry === 'object' &&
					entry !== null &&
					typeof (entry as StoredReaction).emoji === 'string' &&
					typeof (entry as StoredReaction).userKey === 'string' &&
					typeof (entry as StoredReaction).at === 'string'
			)
		: []

/**
 * Apply one add or remove to a message's stored reactions, with the same rules
 * as the collection storage: adding twice and removing nothing are no-ops, and
 * past `maxPerUser` an add is refused (`'limit'`) or replaces the viewer's
 * oldest reactions on that message.
 */
export const applyReaction = (
	current: StoredReaction[],
	args: {
		at: string
		emoji: string
		maxPerUser: null | number
		onLimit: 'reject' | 'replace'
		operation: 'add' | 'remove'
		userKey: string
	}
): 'limit' | ReactionChange => {
	const { emoji, userKey } = args
	const exists = current.some((entry) => entry.userKey === userKey && entry.emoji === emoji)
	if (args.operation === 'remove') {
		return exists
			? {
					added: null,
					next: current.filter((entry) => !(entry.userKey === userKey && entry.emoji === emoji)),
					removed: [emoji],
				}
			: { added: null, next: current, removed: [] }
	}
	if (exists) {
		return { added: null, next: current, removed: [] }
	}
	const own = current.filter((entry) => entry.userKey === userKey)
	const over = args.maxPerUser ? own.length + 1 - args.maxPerUser : 0
	if (over > 0 && args.onLimit === 'reject') {
		return 'limit'
	}
	const pushedOut = new Set(
		[...own]
			.sort((a, b) => a.at.localeCompare(b.at))
			.slice(0, Math.max(0, over))
			.map((entry) => entry.emoji)
	)
	return {
		added: emoji,
		next: [
			...current.filter((entry) => !(entry.userKey === userKey && pushedOut.has(entry.emoji))),
			{ at: args.at, emoji, userKey },
		],
		removed: [...pushedOut],
	}
}
