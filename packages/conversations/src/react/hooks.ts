'use client'

import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react'

import { formatCursor } from '../shared/cursor'
import type { ChannelMeta, MentionCandidate } from '../shared/wire'
import type { AuthorsMap, LocalizedLabel } from '../types'
import { ConversationsRequestError } from './api'
import { useChatStore } from './provider'
import {
	dividerBefore,
	initialWindow,
	newestUpdate,
	type WindowMessage,
	type WindowState,
	windowReducer,
} from './window'

/** A label in the given locale, falling back to English, then to any. */
export const resolveLabel = (label: LocalizedLabel | undefined, locale?: string): string => {
	if (label === undefined) return ''
	if (typeof label === 'string') return label
	return (locale ? label[locale] : undefined) ?? label.en ?? Object.values(label)[0] ?? ''
}

export type ChannelView = ChannelMeta & { canCreate: boolean; slug: string; unread: number }

export type UseChannelsResult = {
	/** Readable channels of the key, in instance order. Empty: render nothing. */
	channels: ChannelView[]
	/** Visible root messages across the readable channels. */
	count: number
	error?: Error
	/** False with `reads: false`: hide unread UI. */
	reads: boolean
	status: 'error' | 'loading' | 'ready'
	/** Unread root messages across the readable channels. */
	unread: number
	viewer: null | string
}

/**
 * Readable channels of a conversation, with create rights, labels, cues and
 * unread counts. Mounting it subscribes the key; many mounts in one tick share
 * one request.
 */
export const useChannels = (
	key: null | string | undefined,
	/** `count: false` skips the message count (one query per key) when it is not shown. */
	{ count = true }: { count?: boolean } = {}
): UseChannelsResult => {
	const store = useChatStore()
	useEffect(() => (key ? store.retain(key, { count }) : undefined), [count, key, store])
	useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
	const entry = key ? store.entry(key) : undefined
	const error = key ? store.error(key) : undefined
	const meta = store.meta
	return useMemo(() => {
		const channels: ChannelView[] = (entry?.channels ?? []).map((channel) => ({
			...(meta?.channels[channel.slug] ?? { label: channel.slug }),
			canCreate: channel.canCreate,
			slug: channel.slug,
			unread: entry?.unread?.[channel.slug] ?? 0,
		}))
		return {
			channels,
			count: entry?.count ?? 0,
			error,
			reads: meta?.reads ?? false,
			status: entry ? 'ready' : error ? 'error' : 'loading',
			unread: channels.reduce((sum, channel) => sum + channel.unread, 0),
			viewer: meta?.viewer ?? null,
		}
	}, [entry, error, meta])
}

/** Unread counts per channel for many keys: `{ [key]: { [channel]: count } }`. */
export const useUnread = (keys: string[]): Record<string, Record<string, number>> => {
	const store = useChatStore()
	const joined = keys.join('\n')
	useEffect(() => {
		const releases = joined ? joined.split('\n').map((key) => store.retain(key)) : []
		return () => {
			for (const release of releases) release()
		}
	}, [joined, store])
	const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
	// biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the store's change signal.
	return useMemo(() => {
		const out: Record<string, Record<string, number>> = {}
		for (const key of joined ? joined.split('\n') : []) {
			out[key] = store.entry(key)?.unread ?? {}
		}
		return out
	}, [joined, store, version])
}

export type UseConversationArgs = {
	channel?: string
	/** Several channels in one feed, e.g. an "all" view. */
	channels?: string[]
	key: string
	/** Page size. Default 30. */
	limit?: number
	/** A root message id: the thread under it. */
	parent?: null | string
}

export type UseConversationResult = {
	authors: AuthorsMap
	/** Id of the first unread message; render the "New messages" divider above it. */
	dividerBefore: null | string
	error: Error | null
	hasNewer: boolean
	hasOlder: boolean
	/** Resets the window to the newest page. */
	jumpToLatest: () => Promise<void>
	loadNewer: () => Promise<void>
	loadOlder: () => Promise<void>
	/**
	 * The user has seen everything up to the newest message in the window:
	 * call when the feed is visible and scrolled to its end. Raises the read
	 * cursor, never lowers it.
	 */
	markSeen: () => void
	messages: WindowMessage[]
	status: 'error' | 'idle' | 'loading' | 'ready'
	/** The viewer's thread cursors, for "N replies · new". */
	threadReads: Record<string, string>
	viewer: null | string
}

/** How far back change sync looks past the newest update it holds. */
const SYNC_OVERLAP_MS = 10_000

/**
 * One feed or thread as a bidirectional window: opens at the latest page, or
 * around the first unread message when there are more than a page; loads
 * older and newer pages; merges change sync and this tab's own sends by id.
 */
export const useConversation = ({
	channel,
	channels: channelList,
	key,
	limit = 30,
	parent = null,
}: UseConversationArgs): UseConversationResult => {
	const store = useChatStore()
	// Compared by value: callers pass fresh arrays on every render.
	const channelsKey = (channelList ?? (channel ? [channel] : [])).join(',')
	const channels = useMemo(() => (channelsKey ? channelsKey.split(',') : []), [channelsKey])
	const [state, dispatch] = useReducer(windowReducer, initialWindow)
	const [authors, setAuthors] = useState<AuthorsMap>({})
	const [threadReads, setThreadReads] = useState<Record<string, string>>({})
	const [error, setError] = useState<Error | null>(null)
	const stateRef = useRef(state)
	stateRef.current = state
	const authorsRef = useRef(authors)
	authorsRef.current = authors
	const threadReadsRef = useRef(threadReads)
	threadReadsRef.current = threadReads
	/** Which window this is, for the provider's reopen cache. */
	const cacheId = `${key}|${channelsKey}|${parent ?? ''}|${limit}`
	/** The window the reducer state belongs to; it lags a render behind a switch. */
	const owner = useRef<null | string>(null)
	const generation = useRef(0)
	const viewer = store.meta?.viewer ?? null
	useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)

	const addAuthors = useCallback((more: AuthorsMap) => {
		setAuthors((current) => ({ ...current, ...more }))
	}, [])
	const addThreadReads = useCallback((more: Record<string, string> | undefined) => {
		if (more) setThreadReads((current) => ({ ...current, ...more }))
	}, [])

	const load = useCallback(
		async (latest: boolean) => {
			if (!channelsKey) return
			const run = ++generation.current
			dispatch({ type: 'loading' })
			try {
				const page = await store.api.list({
					channels: channelsKey.split(','),
					key,
					latest,
					limit,
					parent,
				})
				if (run !== generation.current) return
				addAuthors(page.authors)
				addThreadReads(page.threadReads)
				dispatch({
					cursor: page.cursor,
					hasNewer: page.hasNewer,
					hasOlder: page.hasOlder,
					messages: page.messages,
					type: 'loaded',
				})
				setError(null)
			} catch (caught) {
				if (run !== generation.current) return
				setError(caught instanceof Error ? caught : new Error(String(caught)))
				dispatch({ type: 'error' })
			}
		},
		[addAuthors, addThreadReads, channelsKey, key, limit, parent, store]
	)

	/** Changes since the newest update in `base` (default: the current window), merged in. */
	const sync = useCallback(
		async (base?: WindowState) => {
			if (!channelsKey) return
			const current = base ?? stateRef.current
			if (current.status !== 'ready') return
			const newest = newestUpdate(current.messages)
			const since = new Date(
				(newest ? new Date(newest).getTime() : Date.now()) - SYNC_OVERLAP_MS
			).toISOString()
			try {
				const page = await store.api.list({
					channels: channelsKey.split(','),
					key,
					parent,
					updatedSince: since,
				})
				addAuthors(page.authors)
				addThreadReads(page.threadReads)
				dispatch({ messages: page.messages, type: 'changes' })
			} catch {
				// The next change signal retries.
			}
		},
		[addAuthors, addThreadReads, channelsKey, key, parent, store]
	)

	// Keep this window for a reopen when it unmounts or switches to another feed.
	useEffect(
		() => () => {
			const current = stateRef.current
			if (owner.current !== cacheId || current.status !== 'ready') return
			store.cacheWindow(cacheId, {
				authors: authorsRef.current,
				// Unconfirmed sends are not kept: change sync brings the confirmed ones.
				state: { ...current, messages: current.messages.filter((message) => !message.sendStatus) },
				threadReads: threadReadsRef.current,
			})
		},
		[cacheId, store]
	)

	// Open from the cache when this window was shown before, then catch up; else load.
	useEffect(() => {
		owner.current = cacheId
		const cached = store.cachedWindow(cacheId)
		if (cached) {
			generation.current++
			setAuthors(cached.authors)
			setThreadReads(cached.threadReads)
			setError(null)
			dispatch({ state: cached.state, type: 'restore' })
			void sync(cached.state)
			return
		}
		setAuthors({})
		setThreadReads({})
		dispatch({ type: 'reset' })
		void load(false)
	}, [cacheId, load, store, sync])

	useEffect(() => {
		const release = store.retain(key)
		store.setActive(key, true)
		return () => {
			store.setActive(key, false)
			release()
		}
	}, [key, store])

	useEffect(() => {
		if (!channelsKey) return
		const offChange = store.onChange(key, () => void sync())
		const offLocal = store.onLocal(key, (event) => {
			if (event.type === 'failed') {
				dispatch(event)
				return
			}
			if (event.type === 'threadRead') {
				// Only feeds of roots care; a thread window keeps its own cursor.
				if (!parent) addThreadReads({ [event.root]: event.at })
				return
			}
			const message = event.message
			if (
				(message.parent ?? null) !== parent ||
				!channelsKey.split(',').includes(message.channel)
			) {
				return
			}
			dispatch({ message, type: event.type })
		})
		return () => {
			offChange()
			offLocal()
		}
	}, [addThreadReads, channelsKey, key, parent, store, sync])

	const loadOlder = useCallback(async () => {
		const first = stateRef.current.messages.find((message) => !message.sendStatus)
		if (!first || !stateRef.current.hasOlder) return
		const page = await store.api.list({
			before: formatCursor(first),
			channels,
			key,
			limit,
			parent,
		})
		addAuthors(page.authors)
		addThreadReads(page.threadReads)
		dispatch({ hasOlder: page.hasOlder, messages: page.messages, type: 'older' })
	}, [addAuthors, addThreadReads, channels, key, limit, parent, store])

	const loadNewer = useCallback(async () => {
		const confirmed = stateRef.current.messages.filter((message) => !message.sendStatus)
		const last = confirmed.at(-1)
		if (!last || !stateRef.current.hasNewer) return
		const page = await store.api.list({
			after: formatCursor(last),
			channels,
			key,
			limit,
			parent,
		})
		addAuthors(page.authors)
		addThreadReads(page.threadReads)
		dispatch({ hasNewer: page.hasNewer, messages: page.messages, type: 'newer' })
	}, [addAuthors, addThreadReads, channels, key, limit, parent, store])

	const markSeen = useCallback(() => {
		const current = stateRef.current
		if (current.hasNewer || !store.meta?.reads) return
		const newest = current.messages.filter((message) => !message.sendStatus).at(-1)
		if (!newest) return
		if (current.seenAt && new Date(current.seenAt) >= new Date(newest.createdAt)) return
		dispatch({ at: newest.createdAt, type: 'seen' })
		if (parent) {
			// Reading a thread clears its "new" mark in the feed behind it at once.
			store.emitLocal(key, { at: newest.createdAt, root: parent, type: 'threadRead' })
		}
		void store.api
			.read({ at: newest.createdAt, key, ...(parent ? { thread: parent } : { channels }) })
			.then(() => store.touched([key]))
			.catch(() => undefined)
	}, [channels, key, parent, store])

	// Right after a switch (another channel, another thread) the state is still
	// the previous feed's: show the new one's cached window, or a loading one.
	const own = owner.current === cacheId
	const cachedView = own ? undefined : store.cachedWindow(cacheId)
	const view = own
		? state
		: cachedView
			? windowReducer(initialWindow, { state: cachedView.state, type: 'restore' })
			: windowReducer(initialWindow, { type: 'reset' })

	return {
		authors: own ? authors : (cachedView?.authors ?? {}),
		dividerBefore: dividerBefore(view, viewer),
		error: own ? error : null,
		hasNewer: view.hasNewer,
		hasOlder: view.hasOlder,
		jumpToLatest: () => load(true),
		loadNewer,
		loadOlder,
		markSeen,
		messages: view.messages,
		status: view.status,
		threadReads: own ? threadReads : (cachedView?.threadReads ?? {}),
		viewer,
	}
}

export type SendInput = { body: unknown } | { text: string }

const newClientId = () =>
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * Send into a conversation: an idempotent `clientId`, an optimistic message
 * in every window showing the channel, and `retry` for a failed send.
 */
export const useSend = ({
	channel,
	key,
	parent = null,
}: {
	channel: string
	key: string
	parent?: null | string
}) => {
	const store = useChatStore()
	const pending = useRef(new Map<string, SendInput>())

	const deliver = useCallback(
		async (clientId: string, input: SendInput) => {
			const viewer = store.meta?.viewer ?? ''
			const now = new Date().toISOString()
			store.emitLocal(key, {
				message: {
					authorKey: viewer,
					body: 'body' in input ? input.body : undefined,
					channel,
					clientId,
					createdAt: now,
					id: `local:${clientId}`,
					key,
					parent,
					sendStatus: 'sending',
					text: 'text' in input ? input.text : null,
					type: 'text',
					updatedAt: now,
				},
				type: 'optimistic',
			})
			try {
				const result = await store.api.send({ channel, clientId, key, parent, ...input })
				pending.current.delete(clientId)
				store.emitLocal(key, { message: result.message, type: 'confirmed' })
				if (result.root) {
					// The root's reply count and last reply, for feeds showing it; and the
					// sender has read their own reply.
					store.emitLocal(key, { message: result.root, type: 'confirmed' })
					store.emitLocal(key, {
						at: result.message.createdAt,
						root: String(result.root.id),
						type: 'threadRead',
					})
				}
				store.touched([key])
				return result.message
			} catch (caught) {
				store.emitLocal(key, { clientId, type: 'failed' })
				// The id travels with the error, so a caller can offer `retry(clientId)`.
				throw Object.assign(caught instanceof Error ? caught : new Error(String(caught)), {
					clientId,
				})
			}
		},
		[channel, key, parent, store]
	)

	const send = useCallback(
		(input: SendInput) => {
			const clientId = newClientId()
			pending.current.set(clientId, input)
			return deliver(clientId, input)
		},
		[deliver]
	)

	/** Send a failed message again under the same `clientId`, so it is never doubled. */
	const retry = useCallback(
		(clientId: string) => {
			const input = pending.current.get(clientId)
			if (!input) return Promise.reject(new Error('Nothing to retry'))
			return deliver(clientId, input)
		},
		[deliver]
	)

	return { retry, send }
}

/** Edit and delete, with the result merged into every window showing the message. */
export const useMessageActions = () => {
	const store = useChatStore()
	const edit = useCallback(
		async (message: WindowMessage, input: SendInput) => {
			const result = await store.api.edit(message.id, input)
			store.emitLocal(message.key, { message: result.message, type: 'confirmed' })
			store.touched([message.key])
			return result.message
		},
		[store]
	)
	const remove = useCallback(
		async (message: WindowMessage) => {
			const result = await store.api.delete(message.id)
			store.emitLocal(message.key, { message: result.message, type: 'confirmed' })
			if (result.root) store.emitLocal(message.key, { message: result.root, type: 'confirmed' })
			store.touched([message.key])
			return result.message
		},
		[store]
	)
	return { edit, remove }
}

/** An extension's public `client` data from the instance config, once subscribed. */
export const useExtension = <T = unknown>(name: string): T | undefined => {
	const store = useChatStore()
	useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
	return store.meta?.extensionData?.[name] as T | undefined
}

/**
 * Talk to an extension's endpoints. `merge` puts messages an endpoint returned
 * into every open window showing them and tells other tabs, as an edit does.
 */
export const useExtensionApi = (name: string) => {
	const store = useChatStore()
	return useMemo(
		() => ({
			merge: (messages: WindowMessage[]) => {
				const keys = new Set<string>()
				for (const message of messages) {
					store.emitLocal(message.key, { message, type: 'confirmed' })
					keys.add(message.key)
				}
				store.touched([...keys])
			},
			request: <T>(path: string, init?: { body?: unknown; method?: string }) =>
				store.api.extension<T>(name, path, init),
		}),
		[name, store]
	)
}

/** Mention candidates for a query, debounced; stale answers are dropped. */
export const useMentionSearch = ({
	channel,
	debounce = 150,
	key,
	query,
}: {
	channel: string
	debounce?: number
	key: string
	query: null | string
}): { loading: boolean; users: MentionCandidate[] } => {
	const store = useChatStore()
	const [users, setUsers] = useState<MentionCandidate[]>([])
	const [loading, setLoading] = useState(false)
	useEffect(() => {
		if (query === null) {
			setUsers([])
			setLoading(false)
			return
		}
		const controller = new AbortController()
		setLoading(true)
		const timer = setTimeout(() => {
			store.api
				.mentions({ channel, key, q: query }, controller.signal)
				.then((result) => {
					setUsers(result.users)
					setLoading(false)
				})
				.catch((caught: unknown) => {
					if (caught instanceof ConversationsRequestError || !controller.signal.aborted) {
						setUsers([])
						setLoading(false)
					}
				})
		}, debounce)
		return () => {
			clearTimeout(timer)
			controller.abort()
		}
	}, [channel, debounce, key, query, store])
	return { loading, users }
}
