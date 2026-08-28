import type { PayloadHandler } from 'payload'

import type { EventBroker, RealtimeEvent } from '../broker/types'
import { type AuthorizedTopic, authorizeTopics } from './authorizeTopics'
import { encodeComment, encodeEvent, encodeRetry } from './encode'
import { enrichForUser } from './enrichForUser'

export const STREAM_PATH = '/realtime/stream'

export type StreamHandlerDeps = {
	broker: EventBroker
	collections: Record<string, { thinEvents: boolean }>
	heartbeatMs: number
}

const parseTopicsParam = (url: string | undefined): string[] => {
	const raw = new URL(url ?? '', 'http://localhost').searchParams.get('topics')
	if (raw === null || raw.trim() === '') return []
	return raw
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
}

const readyEvent = (topics: AuthorizedTopic[]): RealtimeEvent<{ topics: AuthorizedTopic[] }> => ({
	id: 'ready',
	topic: 'ready',
	event: 'ready',
	timestamp: Date.now(),
	data: { topics },
})

/**
 * Authenticated GET handler for the SSE stream. Authorizes topics at connect,
 * emits retry + ready, heartbeats, and broker events until `req.signal` aborts.
 */
export const makeStreamHandler = (deps: StreamHandlerDeps): PayloadHandler => {
	const { broker, collections, heartbeatMs } = deps

	return async (req) => {
		if (!req.user) {
			return Response.json({ message: 'unauthorized' }, { status: 401 })
		}

		const topicNames = parseTopicsParam(req.url)
		const auth = await authorizeTopics({ req, topics: topicNames, collections })
		if (!auth.ok) {
			return Response.json({ message: auth.message }, { status: auth.status })
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
					const unsub = broker.subscribe(topic.topic, (event: RealtimeEvent) => {
						enrichChain = enrichChain
							.then(async () => {
								if (closed) return
								const frame =
									topic.mode === 'enriched' && event.docId && event.collection
										? await enrichForUser({
												event,
												collection: event.collection,
												docId: event.docId,
												req,
											})
										: event
								if (closed) return
								enqueue(encodeEvent(frame))
							})
							.catch(() => {
								teardown()
							})
					})
					unsubscribers.push(unsub)
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
