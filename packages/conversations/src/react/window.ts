import type { ConversationMessage } from '../types'

/** A message in a client window. Optimistic sends carry a local status until the server answers. */
export type WindowMessage = ConversationMessage & {
	/** Set by the server on change sync: the message is gone from feeds. */
	removed?: boolean
	/** Local only: `sending` until confirmed, `failed` if the request failed. */
	sendStatus?: 'failed' | 'sending'
}

export type WindowState = {
	/** The viewer's read cursor as it was when the window opened; places the divider. */
	cursor: null | string
	hasNewer: boolean
	hasOlder: boolean
	/** Oldest first; ties on `createdAt` ordered by id. */
	messages: WindowMessage[]
	/** The newest `createdAt` reported through `markSeen`; only ever rises. */
	seenAt: null | string
	status: 'error' | 'idle' | 'loading' | 'ready'
}

export type WindowAction =
	| {
			cursor?: null | string
			hasNewer: boolean
			hasOlder: boolean
			messages: WindowMessage[]
			type: 'loaded'
	  }
	| { hasOlder: boolean; messages: WindowMessage[]; type: 'older' }
	| { hasNewer: boolean; messages: WindowMessage[]; type: 'newer' }
	| { messages: WindowMessage[]; type: 'changes' }
	| { message: WindowMessage; type: 'optimistic' }
	| { clientId: string; type: 'failed' }
	| { message: WindowMessage; type: 'confirmed' }
	| { at: string; type: 'seen' }
	| { type: 'loading' }
	| { type: 'error' }

export const initialWindow: WindowState = {
	cursor: null,
	hasNewer: false,
	hasOlder: false,
	messages: [],
	seenAt: null,
	status: 'idle',
}

const time = (value: string) => new Date(value).getTime()

const compareIds = (a: number | string, b: number | string) => {
	if (typeof a === 'number' && typeof b === 'number') {
		return a - b
	}
	const left = String(a)
	const right = String(b)
	if (left.length !== right.length) {
		return left.length - right.length
	}
	return left < right ? -1 : left > right ? 1 : 0
}

/** Keyset order: `createdAt`, then id. Optimistic messages sort by their local time. */
export const compareMessages = (a: WindowMessage, b: WindowMessage): number =>
	time(a.createdAt) - time(b.createdAt) || compareIds(a.id, b.id)

const identity = (message: WindowMessage) =>
	message.clientId ? `c:${message.clientId}` : `i:${String(message.id)}`

/**
 * Merge incoming rows into a window by id (and by `clientId`, so a confirmed
 * send replaces its optimistic copy). Removed rows drop out. With `bounded`,
 * rows newer than the window's newest are ignored: while `hasNewer` the window
 * is not at the end, and appending would leave a gap.
 */
export const mergeMessages = (
	current: WindowMessage[],
	incoming: WindowMessage[],
	bounded = false
): WindowMessage[] => {
	const byId = new Map<string, WindowMessage>()
	const idOf = new Map<string, string>()
	for (const message of current) {
		byId.set(String(message.id), message)
		idOf.set(identity(message), String(message.id))
	}
	const newest = current.at(-1)
	for (const message of incoming) {
		const existingId = byId.has(String(message.id))
			? String(message.id)
			: idOf.get(identity(message))
		if (existingId === undefined && bounded && newest && compareMessages(message, newest) > 0) {
			continue
		}
		if (existingId !== undefined) {
			byId.delete(existingId)
		}
		if (!message.removed) {
			byId.set(String(message.id), message)
		}
	}
	return [...byId.values()].sort(compareMessages)
}

export const windowReducer = (state: WindowState, action: WindowAction): WindowState => {
	switch (action.type) {
		case 'loading':
			return { ...state, status: 'loading' }
		case 'error':
			return { ...state, status: 'error' }
		case 'loaded':
			return {
				cursor: action.cursor === undefined ? state.cursor : action.cursor,
				hasNewer: action.hasNewer,
				hasOlder: action.hasOlder,
				messages: mergeMessages([], action.messages),
				seenAt: state.seenAt,
				status: 'ready',
			}
		case 'older':
			return {
				...state,
				hasOlder: action.hasOlder,
				messages: mergeMessages(state.messages, action.messages),
			}
		case 'newer':
			return {
				...state,
				hasNewer: action.hasNewer,
				messages: mergeMessages(state.messages, action.messages),
			}
		case 'changes':
			return { ...state, messages: mergeMessages(state.messages, action.messages, state.hasNewer) }
		case 'optimistic':
			return state.hasNewer
				? state
				: { ...state, messages: mergeMessages(state.messages, [action.message]) }
		case 'confirmed':
			return {
				...state,
				messages: mergeMessages(state.messages, [action.message], state.hasNewer),
			}
		case 'failed':
			return {
				...state,
				messages: state.messages.map((message) =>
					message.clientId === action.clientId && message.sendStatus
						? { ...message, sendStatus: 'failed' }
						: message
				),
			}
		case 'seen':
			return state.seenAt && time(state.seenAt) >= time(action.at)
				? state
				: { ...state, seenAt: action.at }
	}
}

/**
 * The first message the divider sits above: the oldest one newer than the
 * cursor the window opened with, written by someone else. `null` hides it.
 */
export const dividerBefore = (state: WindowState, viewer: null | string): null | string => {
	if (!state.cursor) {
		return null
	}
	const cursor = time(state.cursor)
	const first = state.messages.find(
		(message) =>
			!message.sendStatus && message.authorKey !== viewer && time(message.createdAt) > cursor
	)
	return first ? String(first.id) : null
}

/** The newest `updatedAt` in a window: where change sync picks up from. */
export const newestUpdate = (messages: WindowMessage[]): null | string => {
	let newest: null | string = null
	for (const message of messages) {
		if (!message.sendStatus && (!newest || time(message.updatedAt) > time(newest))) {
			newest = message.updatedAt
		}
	}
	return newest
}
