import type { AuthorProjection, AuthorsMap, ConversationMessage, LocalizedLabel } from '../types'

/**
 * Request and response shapes of the instance endpoints, shared by the server
 * and the browser clients. Types only.
 */

export type WireMessage = ConversationMessage & { removed?: boolean }

export type ChannelAccess = { canCreate: boolean; slug: string }

export type ChannelMeta = {
	cue?: { label: LocalizedLabel; tone: 'neutral' | 'warning' }
	label: LocalizedLabel
}

export type SubscribeEntry = {
	channels: ChannelAccess[]
	/** Visible root messages across the readable channels. */
	count: number
	key: string
	token: string
	/** Unread root messages per channel; absent with `reads: false`. */
	unread?: Record<string, number>
}

export type SubscribeResponse = {
	/** Labels and cues of every instance channel. */
	channels: Record<string, ChannelMeta>
	deleted: 'placeholder' | 'placeholderIfReplies'
	entries: SubscribeEntry[]
	/** Names of the instance's extensions. */
	extensions: string[]
	/** Server time; the first poll looks back from here. */
	now: string
	reads: boolean
	/** The signed-in user's key. */
	viewer: string
}

export type ListResponse = {
	authors: AuthorsMap
	/** The viewer's cursor before this load, for the "New messages" divider. */
	cursor?: null | string
	hasNewer: boolean
	hasOlder: boolean
	messages: WireMessage[]
	/** The viewer's thread cursors for the roots in this page. */
	threadReads?: Record<string, string>
}

export type MessageResponse = { authors: AuthorsMap; message: WireMessage }

export type PollResponse = { changed: string[]; expired: string[]; now: string }

export type MentionCandidate = AuthorProjection & { userKey: string }

export type MentionsResponse = { users: MentionCandidate[] }
