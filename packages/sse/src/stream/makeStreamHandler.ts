import type { CollectionSlug, PayloadHandler, PayloadRequest } from 'payload'

import type { EventBroker, RealtimeEvent } from '../broker/types'
import { toBrokerChannels } from '../scope/resolveScope'
import type { SSEScopeOptions } from '../scope/types'
import { type AuthorizedTopic, authorizeTopics } from './authorizeTopics'
import { encodeComment, encodeEvent, encodeRetry } from './encode'
import { enrichForUser } from './enrichForUser'

export const STREAM_PATH = '/realtime/stream'

export type StreamHandlerDeps = {
	broker: EventBroker
	collections: Record<string, { thinEvents: boolean }>
	heartbeatMs: number
	scope?: SSEScopeOptions | false
	/** Concurrent streams per user id. Default 8. */
	maxConnectionsPerUser?: number
	/** Shared across handler instances so the cap survives per-request factories. */
	connections?: Map<string, number>
}

const parseTopicsParam = (url: string | undefined): string[] => {
	const raw = new URL(url ?? '', 'http://localhost').searchParams.get('topics')
	if (raw === null || raw.trim() === '') return []
	return [
		...new Set(
			raw
				.split(',')
				.map((t) => t.trim())
				.filter((t) => t.length > 0)
		),
	]
}

const readyEvent = (topics: AuthorizedTopic[]): RealtimeEvent<{ topics: AuthorizedTopic[] }> => ({
	id: 'ready',
	topic: 'ready',
	event: 'ready',
	timestamp: Date.now(),
	data: { topics },
})

const subscribeKeys = (topic: AuthorizedTopic): string[] => {
	if (topic.scopes === undefined) return [topic.topic]
	return toBrokerChannels(topic.scopes, topic.topic)
}

const isDelete = (event: RealtimeEvent): boolean =>
	event.event === 'delete' || event.operation === 'delete'

const prepareFrame = async (args: {
	event: RealtimeEvent
	topic: AuthorizedTopic
	req: PayloadRequest
}): Promise<RealtimeEvent | null> => {
	const { event, topic, req } = args
	const publicEvent: RealtimeEvent = { ...event, topic: topic.topic }

	if (topic.gate === 'per-event') {
		if (isDelete(event)) {
			const { docId: _docId, data: _data, ...rest } = publicEvent
			return {
				...rest,
				id: `${event.timestamp}:${event.collection}:delete:${topic.topic}`,
			}
		}
		if (!event.docId || !event.collection) return publicEvent
		if (topic.mode === 'enriched') {
			return enrichForUser({
				event: publicEvent,
				collection: event.collection,
				docId: event.docId,
				req,
				onDeny: 'drop',
			})
		}
		const counted = await req.payload.count({
			collection: event.collection as CollectionSlug,
			where: { id: { equals: event.docId } },
			req,
			overrideAccess: false,
		})
		return counted.totalDocs < 1 ? null : publicEvent
	}

	if (topic.mode === 'enriched' && event.docId && event.collection) {
		return (
			(await enrichForUser({
				event: publicEvent,
				collection: event.collection,
				docId: event.docId,
				req,
			})) ?? publicEvent
		)
	}
	return publicEvent
}

/**
 * Authenticated GET handler for the SSE stream. Authorizes topics at connect,
 * emits retry + ready, heartbeats, and broker events until `req.signal` aborts.
 */
export const makeStreamHandler = (deps: StreamHandlerDeps): PayloadHandler => {
	const {
		broker,
		collections,
		heartbeatMs,
		scope = false,
		maxConnectionsPerUser = 8,
		connections = new Map<string, number>(),
	} = deps

	return async (req) => {
		if (!req.user) {
			return Response.json({ message: 'unauthorized' }, { status: 401 })
		}

		const topicNames = parseTopicsParam(req.url)
		const auth = await authorizeTopics({ req, topics: topicNames, collections, scope })
		if (!auth.ok) {
			return Response.json({ message: auth.message }, { status: auth.status })
		}

		const userId = String((req.user as { id: unknown }).id)
		const open = connections.get(userId) ?? 0
		if (open >= maxConnectionsPerUser) {
			return Response.json({ message: 'too many connections' }, { status: 429 })
		}
		connections.set(userId, open + 1)
		let released = false
		const release = () => {
			if (released) return
			released = true
			const next = (connections.get(userId) ?? 1) - 1
			if (next <= 0) connections.delete(userId)
			else connections.set(userId, next)
		}

		const signal = (req as unknown as Request).signal as AbortSignal | undefined
		const unsubscribers: Array<() => void> = []
		let heartbeat: ReturnType<typeof setInterval> | undefined
		let closed = false

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder()
				let enrichChain: Promise<void> = Promise.resolve()
				const enqueue = (chunk: string) => {
					if (closed) return
					try {
						controller.enqueue(encoder.encode(chunk))
					} catch {
						teardown()
					}
				}

				const teardown = () => {
					if (closed) return
					closed = true
					release()
					enrichChain = Promise.resolve()
					if (heartbeat !== undefined) {
						clearInterval(heartbeat)
						heartbeat = undefined
					}
					for (const unsub of unsubscribers) {
						try {
							unsub()
						} catch {
							// Unsubscribe must not throw during teardown.
						}
					}
					unsubscribers.length = 0
					try {
						controller.close()
					} catch {
						// Already closed.
					}
				}

				enqueue(encodeRetry(3000) + encodeEvent(readyEvent(auth.topics)))

				for (const topic of auth.topics) {
					for (const key of subscribeKeys(topic)) {
						const unsub = broker.subscribe(key, (event: RealtimeEvent) => {
							enrichChain = enrichChain
								.then(async () => {
									if (closed) return
									const frame = await prepareFrame({ event, topic, req })
									if (closed || frame == null) return
									enqueue(encodeEvent(frame))
								})
								.catch((err) => {
									req.payload.logger.error(
										`@10x-media/sse: frame preparation failed: ${err instanceof Error ? err.message : String(err)}`
									)
									teardown()
								})
						})
						unsubscribers.push(unsub)
					}
				}

				heartbeat = setInterval(() => {
					enqueue(encodeComment('heartbeat'))
				}, heartbeatMs)

				if (signal) {
					if (signal.aborted) {
						teardown()
					} else {
						signal.addEventListener('abort', teardown, { once: true })
					}
				}
			},
			cancel() {
				closed = true
				release()
				if (heartbeat !== undefined) {
					clearInterval(heartbeat)
					heartbeat = undefined
				}
				for (const unsub of unsubscribers) {
					try {
						unsub()
					} catch {
						// Unsubscribe must not throw during cancel.
					}
				}
				unsubscribers.length = 0
			},
		})

		return new Response(stream, {
			status: 200,
			headers: {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no',
			},
		})
	}
}
