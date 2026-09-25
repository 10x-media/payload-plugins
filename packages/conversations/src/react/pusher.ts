import { PUSHER_EVENT, pusherChannelName } from '../shared/pusher'
import type { PusherClientOptions } from '../types'
import { browserPollerEnv, type PollerEnv } from './poller'
import { createRelay, type RealtimeSource, type SourceHandlers } from './relay'
import {
	type ConversationsClientTransport,
	pollingTransport,
	type TransportConnectArgs,
} from './transport'

/** Waits between reconnects, then the last one repeats. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]
/** How long a ping may go unanswered before the socket counts as dead. */
const PONG_TIMEOUT_MS = 30_000

type Frame = { channel?: string; data?: unknown; event: string }

type SocketLike = Pick<WebSocket, 'close' | 'send'> & {
	onclose: ((event: { code?: number }) => void) | null
	onmessage: ((event: { data: unknown }) => void) | null
	onopen: (() => void) | null
}

export type SocketConstructor = new (url: string) => SocketLike

const parseData = (data: unknown): Record<string, unknown> => {
	if (typeof data === 'string') {
		try {
			return JSON.parse(data) as Record<string, unknown>
		} catch {
			return {}
		}
	}
	return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {}
}

/** The socket URL of a Pusher app, or of a Pusher-compatible server at `wsHost`. */
export const pusherSocketUrl = (options: PusherClientOptions): string => {
	const tls = options.forceTLS ?? true
	const host = options.wsHost ?? `ws-${options.cluster ?? 'mt1'}.pusher.com`
	const port = options.wsPort ?? (tls ? 443 : 80)
	return `${tls ? 'wss' : 'ws'}://${host}:${port}/app/${options.key}?protocol=7&client=conversations&version=1.0&flash=false`
}

/**
 * One Pusher socket, speaking the protocol directly: private channels per
 * (key, conversation channel) authorized through the instance's
 * `/pusher-auth` with the subscription token, pings when idle, and a
 * reconnect with backoff that re-subscribes and reports every key changed,
 * since Pusher does not replay what was missed.
 */
export const createPusherSource = ({
	env,
	handlers,
	instance,
	options,
	post,
	Socket,
}: {
	env: Pick<PollerEnv, 'clearTimeout' | 'setTimeout'>
	handlers: SourceHandlers
	instance: string
	options: PusherClientOptions
	post: TransportConnectArgs['post']
	Socket: SocketConstructor
}): RealtimeSource => {
	/** Channel name -> the key it belongs to and the token that authorizes it. */
	let wanted = new Map<string, { key: string; token: string }>()
	const subscribed = new Set<string>()
	let socket: null | SocketLike = null
	let socketId: null | string = null
	let activityMs = 120_000
	let idleTimer: ReturnType<typeof setTimeout> | undefined
	let retryTimer: ReturnType<typeof setTimeout> | undefined
	let failures = 0
	let connectedBefore = false
	let destroyed = false
	let stopped = false

	const send = (frame: Frame) => socket?.send(JSON.stringify(frame))

	/** After `activityMs` of silence ping; without an answer in time, reconnect. */
	const armIdle = () => {
		if (idleTimer) env.clearTimeout(idleTimer)
		idleTimer = env.setTimeout(() => {
			send({ data: {}, event: 'pusher:ping' })
			idleTimer = env.setTimeout(() => socket?.close(), PONG_TIMEOUT_MS)
		}, activityMs)
	}

	const subscribe = async (channel: string) => {
		const entry = wanted.get(channel)
		if (!entry || !socketId || subscribed.has(channel)) return
		subscribed.add(channel)
		try {
			const { auth } = await post<{ auth: string }>('/pusher-auth', {
				channelName: channel,
				socketId,
				token: entry.token,
			})
			if (wanted.has(channel)) send({ data: { auth, channel }, event: 'pusher:subscribe' })
		} catch {
			// Refused: most likely the token ran out. Renewing it re-subscribes.
			subscribed.delete(channel)
			handlers.expired([entry.key])
		}
	}

	const sync = () => {
		for (const channel of subscribed) {
			if (!wanted.has(channel)) {
				subscribed.delete(channel)
				send({ data: { channel }, event: 'pusher:unsubscribe' })
			}
		}
		for (const channel of wanted.keys()) void subscribe(channel)
	}

	const connect = () => {
		retryTimer = undefined
		if (destroyed || stopped || wanted.size === 0 || socket) return
		const current = new Socket(pusherSocketUrl(options))
		socket = current
		current.onmessage = (event) => {
			armIdle()
			const frame = parseData(event.data) as Frame
			const data = parseData(frame.data)
			switch (frame.event) {
				case 'pusher:connection_established': {
					socketId = typeof data.socket_id === 'string' ? data.socket_id : null
					if (typeof data.activity_timeout === 'number') activityMs = data.activity_timeout * 1000
					failures = 0
					subscribed.clear()
					handlers.health(true)
					sync()
					// Pusher keeps no history: whatever changed while away, look again.
					if (connectedBefore)
						handlers.changed([...new Set([...wanted.values()].map((e) => e.key))])
					connectedBefore = true
					return
				}
				case 'pusher:ping':
					send({ data: {}, event: 'pusher:pong' })
					return
				case 'pusher:error': {
					// 4000-4099: do not reconnect (wrong key, app disabled, over quota).
					const code = typeof data.code === 'number' ? data.code : 0
					if (code >= 4000 && code < 4100) stopped = true
					return
				}
				case 'pusher:subscription_error': {
					const entry = frame.channel ? wanted.get(frame.channel) : undefined
					if (frame.channel) subscribed.delete(frame.channel)
					if (entry) handlers.expired([entry.key])
					return
				}
				case PUSHER_EVENT:
					if (Array.isArray(data.keys)) {
						handlers.changed(data.keys.filter((key): key is string => typeof key === 'string'))
					}
					return
			}
		}
		current.onclose = (event) => {
			if (socket !== current) return
			socket = null
			socketId = null
			subscribed.clear()
			if (idleTimer) env.clearTimeout(idleTimer)
			handlers.health(false)
			if (event.code && event.code >= 4000 && event.code < 4100) stopped = true
			if (destroyed || stopped) return
			retryTimer = env.setTimeout(
				connect,
				BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 30_000
			)
			failures++
		}
	}

	return {
		destroy: () => {
			destroyed = true
			if (idleTimer) env.clearTimeout(idleTimer)
			if (retryTimer) env.clearTimeout(retryTimer)
			socket?.close()
			socket = null
		},
		watch: (entries) => {
			wanted = new Map(
				entries.flatMap((entry) =>
					(entry.channels ?? []).map(
						(channel) =>
							[
								pusherChannelName(instance, entry.key, channel),
								{ key: entry.key, token: entry.token },
							] as const
					)
				)
			)
			if (socket) sync()
			else if (!retryTimer) connect()
		},
	}
}

/**
 * Realtime through Pusher or a Pusher-compatible service, paired with the
 * server's `pusherTransport()`. For hosts that cannot hold connections
 * themselves (serverless). No `pusher-js` needed: the protocol is spoken
 * here over the browser's WebSocket.
 *
 * One tab per browser holds the socket for all of them (see `createRelay`),
 * which also keeps the service's connection count down. While the socket is
 * down, each tab falls back to `fallback` (default `pollingTransport()`).
 */
export const pusherClientTransport = (
	options: PusherClientOptions & {
		env?: () => PollerEnv
		fallback?: ConversationsClientTransport
		/** Replaces the global `WebSocket`, e.g. in tests. */
		Socket?: SocketConstructor
	}
): ConversationsClientTransport => ({
	connect: (args) => {
		const env = (options.env ?? browserPollerEnv)()
		const Socket = options.Socket ?? (globalThis.WebSocket as unknown as SocketConstructor)
		return createRelay({
			...args,
			env,
			fallback: (options.fallback ?? pollingTransport()).connect(args),
			name: 'pusher',
			open: (handlers) =>
				createPusherSource({
					env,
					handlers,
					instance: args.instance,
					options,
					post: args.post,
					Socket,
				}),
		})
	},
})
