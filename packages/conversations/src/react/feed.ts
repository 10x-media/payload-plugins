import type { ReactNode } from 'react'

import { dayKey } from './time'
import type { WindowMessage } from './window'

/** A foreign row shown in the feed at its time, e.g. an audit entry. */
export type FeedItem = { at: string; id: string; node: ReactNode }

/** Where a new calendar day starts, for a day separator: `today`, `yesterday` or a date. */
export type FeedDay = { at: string; relative: 'today' | 'yesterday' | null }

/** One row of a feed, in order, with what a renderer needs to draw it. */
export type FeedRow =
	| { day: FeedDay | null; item: FeedItem; key: string; kind: 'item' }
	| {
			/** A follow-up from the same author within a few minutes: no avatar, no name. */
			compact: boolean
			day: FeedDay | null
			/** The "New messages" divider goes right above this row. */
			divider: boolean
			key: string
			kind: 'message'
			message: WindowMessage
	  }

/** Follow-ups within this window from the same author drop their header. */
export const GROUP_MS = 5 * 60 * 1000

const isCompact = (previous: WindowMessage | undefined, message: WindowMessage) =>
	Boolean(previous) &&
	previous?.authorKey === message.authorKey &&
	!previous.deletedAt &&
	!message.deletedAt &&
	(previous.replyCount ?? 0) === 0 &&
	dayKey(previous.createdAt) === dayKey(message.createdAt) &&
	new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_MS

const relativeDay = (at: string, now: number): FeedDay['relative'] => {
	const key = dayKey(at)
	if (key === dayKey(new Date(now).toISOString())) return 'today'
	if (key === dayKey(new Date(now - 86_400_000).toISOString())) return 'yesterday'
	return null
}

/**
 * Messages and foreign items as feed rows: interleaved by time, a day
 * separator where a new day starts, follow-ups grouped under their author,
 * and the "New messages" divider. Failed sends are left out: the composer
 * keeps their text.
 */
export const buildFeedRows = ({
	dividerBefore,
	isBare,
	items = [],
	messages,
	now = Date.now(),
}: {
	dividerBefore?: null | string
	/** Rows drawn without a frame (`layout: 'bare'` types): never grouped, and they end a group. */
	isBare?: (message: WindowMessage) => boolean
	items?: FeedItem[]
	messages: WindowMessage[]
	now?: number
}): FeedRow[] => {
	type Entry = { at: string; item?: FeedItem; message?: WindowMessage }
	const entries: Entry[] = [
		...messages
			.filter((message) => message.sendStatus !== 'failed')
			.map((message) => ({ at: message.createdAt, message })),
		...items.map((item) => ({ at: item.at, item })),
	].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

	const rows: FeedRow[] = []
	let previousMessage: WindowMessage | undefined
	let previousDay: null | string = null
	for (const entry of entries) {
		const current = dayKey(entry.at)
		const day =
			current !== previousDay ? { at: entry.at, relative: relativeDay(entry.at, now) } : null
		previousDay = current
		if (entry.item) {
			previousMessage = undefined
			rows.push({ day, item: entry.item, key: `item:${entry.item.id}`, kind: 'item' })
			continue
		}
		const message = entry.message as WindowMessage
		const divider = dividerBefore === String(message.id)
		const bare = isBare?.(message) ?? false
		const compact = !day && !divider && !bare && isCompact(previousMessage, message)
		previousMessage = bare ? undefined : message
		rows.push({
			compact,
			day,
			divider,
			key: message.clientId ?? String(message.id),
			kind: 'message',
			message,
		})
	}
	return rows
}
