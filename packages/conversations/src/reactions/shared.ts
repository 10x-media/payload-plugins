import type { AuthorsMap } from '../types'

/** The extension's name: its endpoints, `message.ext.reactions`, `useExtension('reactions')`. */
export const REACTIONS = 'reactions'

/** What the browser gets from the config: the emoji people can pick, and the per-person limit. */
export type ReactionsClientData = {
	/** Reactions stay open in channels the viewer can read but not post in. */
	allowReadOnly: boolean
	emojis: string[]
	maxPerUser: null | number
	onLimit: 'reject' | 'replace'
}

/** One emoji on one message, as `message.ext.reactions` carries it. */
export type ReactionSummary = {
	count: number
	emoji: string
	/** Whether the viewer is among them. */
	mine: boolean
	/** The first few who reacted, for the tooltip. */
	users: Array<{ name: string; userKey: string }>
}

/** A stored reaction row. */
export type ReactionRow = { createdAt?: string; emoji: string; message: string; userKey: string }

/** How many names a summary carries; the tooltip says "and N more" past this. */
export const NAMES_PER_EMOJI = 10

/**
 * Rows grouped by message, then by emoji in the order it was first used,
 * each with its count, the viewer's own flag, and the first names.
 */
export const summarize = (
	rows: ReactionRow[],
	viewer: string,
	names: AuthorsMap
): Record<string, ReactionSummary[]> => {
	const out: Record<string, ReactionSummary[]> = {}
	const sorted = [...rows].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
	for (const row of sorted) {
		const list = out[row.message] ?? []
		out[row.message] = list
		let entry = list.find((item) => item.emoji === row.emoji)
		if (!entry) {
			entry = { count: 0, emoji: row.emoji, mine: false, users: [] }
			list.push(entry)
		}
		entry.count++
		if (row.userKey === viewer) entry.mine = true
		if (entry.users.length < NAMES_PER_EMOJI) {
			entry.users.push({ name: names[row.userKey]?.name ?? '', userKey: row.userKey })
		}
	}
	return out
}
