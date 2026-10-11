import type { Endpoint, Payload, PayloadRequest } from 'payload'

import { changedKeys } from '../server/feed'
import { getInstance, POLL_OVERLAP_MS, viewerKey } from '../server/service'
import { verifyToken } from '../server/tokens'
import type { ConversationsInstance, ConversationsServerTransport } from '../types'
import { type ConversationsBus, databaseBus, type RealtimeSignal } from './bus'

/** Keys one stream follows, with what their tokens allow. */
type Watch = Map<string, { channels: string[]; exp: number }>

type Connection = { send: (event: string, data: unknown) => void; watch: Watch }

/** Tokens a stream may carry, as many as a poll. */
const MAX_TOKENS = 200

/**
 * The connections of one instance in this process, and the bus that feeds
 * them other processes' changes while there are any.
 */
class Hub {
	private readonly connections = new Set<Connection>()
	private stopBus: (() => void) | null = null

	constructor(
		private readonly bus: ConversationsBus,
		private readonly instance: ConversationsInstance
	) {}

	add(connection: Connection, payload: Payload): void {
		this.connections.add(connection)
		this.stopBus ??= this.bus.subscribe({
			instance: this.instance,
			onSignals: (signals) => this.dispatch(signals),
			payload,
			watched: () => [
				...new Set([...this.connections].flatMap((entry) => [...entry.watch.keys()])),
			],
		})
	}

	remove(connection: Connection): void {
		this.connections.delete(connection)
		if (this.connections.size === 0) {
			this.stopBus?.()
			this.stopBus = null
		}
	}

	/** Each connection hears the keys it follows, in the channels its tokens allow. */
	dispatch(signals: RealtimeSignal[]): void {
		const now = Date.now()
		for (const connection of this.connections) {
			const changed = new Set<string>()
			const expired = new Set<string>()
			for (const { channel, key } of signals) {
				const entry = connection.watch.get(key)
				if (!entry) continue
				if (entry.exp <= now) {
					expired.add(key)
					connection.watch.delete(key)
				} else if (!channel || entry.channels.includes(channel)) {
					changed.add(key)
				}
			}
			if (changed.size > 0) {
				connection.send('changed', { at: new Date(now).toISOString(), keys: [...changed] })
			}
			if (expired.size > 0) connection.send('expired', { keys: [...expired] })
		}
	}
}

const readBody = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
	try {
		const body = (await req.json?.()) as unknown
		return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
	} catch {
		return {}
	}
}

/**
 * Realtime over Server-Sent Events, served by Payload itself: no separate
 * server or service. Each browser keeps one streaming request open per
 * instance (one tab holds it for all of them), and hears "these keys
 * changed" the moment a change is written in this process, or within
 * about a second from another process through the `bus` (default: the
 * database, `databaseBus()`). Only signals travel; the client loads the
 * messages themselves through the usual endpoints and their access checks.
 *
 * Needs a server that keeps a Node process running (`next start`, Docker, a
 * VM). On serverless hosts, where functions end after a limit, prefer a
 * hosted pub/sub transport.
 *
 * Proxies: responses carry `X-Accel-Buffering: no` for nginx, and a comment
 * line every `heartbeatMs` (default 20 s) keeps idle connections open.
 */
export const sseTransport = ({
	bus = databaseBus(),
	heartbeatMs = 20_000,
}: {
	bus?: ConversationsBus
	heartbeatMs?: number
} = {}): ConversationsServerTransport => {
	const hubs = new Map<string, Hub>()
	const hubFor = (instance: ConversationsInstance) => {
		let hub = hubs.get(instance.slug)
		if (!hub) {
			hub = new Hub(bus, instance)
			hubs.set(instance.slug, hub)
		}
		return hub
	}

	return {
		client: 'sse',
		endpoints: ({ base, instance }): Endpoint[] => [
			{
				handler: async (req) => {
					const viewer = viewerKey(req)
					const body = await readBody(req)
					const tokens = Array.isArray(body.tokens) ? body.tokens.slice(0, MAX_TOKENS) : []
					const watch: Watch = new Map()
					const expired: string[] = []
					for (const token of tokens) {
						const claims = verifyToken(req.payload.secret, token)
						if (!claims || claims.instance !== instance.slug || claims.userKey !== viewer) {
							if (typeof token === 'string') expired.push(token)
							continue
						}
						watch.set(claims.key, { channels: claims.channels, exp: claims.exp })
					}
					const since = typeof body.since === 'string' ? new Date(body.since) : null
					const hub = hubFor(instance)
					const encoder = new TextEncoder()
					let connection: Connection | null = null
					let heartbeat: ReturnType<typeof setInterval> | undefined

					const close = () => {
						if (heartbeat) clearInterval(heartbeat)
						heartbeat = undefined
						if (connection) hub.remove(connection)
						connection = null
					}

					const stream = new ReadableStream<Uint8Array>({
						cancel: close,
						start: async (controller) => {
							const write = (chunk: string) => {
								try {
									controller.enqueue(encoder.encode(chunk))
								} catch {
									close()
								}
							}
							const send = (event: string, data: unknown) =>
								write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
							connection = { send, watch }
							hub.add(connection, req.payload)
							heartbeat = setInterval(() => write(': ping\n\n'), heartbeatMs)
							req.signal?.addEventListener('abort', () => {
								close()
								try {
									controller.close()
								} catch {
									// Already closed by the runtime.
								}
							})
							const at = new Date()
							send('ready', { at: at.toISOString(), expired })
							// What changed while the browser was reconnecting.
							if (since && !Number.isNaN(since.getTime()) && watch.size > 0) {
								const changed = await changedKeys(req, instance, {
									entries: [...watch].map(([key, entry]) => ({ channels: entry.channels, key })),
									since: new Date(since.getTime() - POLL_OVERLAP_MS).toISOString(),
								})
								if (changed.length > 0) send('changed', { at: at.toISOString(), keys: changed })
							}
						},
					})

					return new Response(stream, {
						headers: {
							'Cache-Control': 'no-cache, no-transform',
							Connection: 'keep-alive',
							'Content-Type': 'text/event-stream; charset=utf-8',
							'X-Accel-Buffering': 'no',
						},
					})
				},
				method: 'post',
				path: `${base}/events`,
			},
		],
		publish: async ({ channel, instance: slug, key, req }) => {
			const hub = hubs.get(slug)
			hub?.dispatch([{ channel, key }])
			if (bus.publish) {
				const instance = getInstance(req, slug)
				await bus.publish({ instance, payload: req.payload, signal: { channel, key } })
			}
		},
	}
}
