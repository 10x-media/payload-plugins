import { type ConversationsBus, databaseBus, type RealtimeSignal } from './bus'

/** What the bus needs from Redis: publish a message, and hear a channel until stopped. */
export type RedisPubSub = {
	publish: (channel: string, message: string) => Promise<unknown> | unknown
	subscribe: (
		channel: string,
		onMessage: (message: string) => void
	) => Promise<() => Promise<unknown> | unknown>
}

/** The ioredis calls the bus makes; any client with this shape works. */
type IoredisLike = {
	on: (event: 'message', listener: (channel: string, message: string) => void) => unknown
	publish: (channel: string, message: string) => Promise<unknown>
	removeListener: (
		event: 'message',
		listener: (channel: string, message: string) => void
	) => unknown
	subscribe: (channel: string) => Promise<unknown>
	unsubscribe: (channel: string) => Promise<unknown>
}

/** The node-redis (v4+) calls the bus makes. */
type NodeRedisLike = {
	publish: (channel: string, message: string) => Promise<unknown>
	subscribe: (channel: string, listener: (message: string) => void) => Promise<unknown>
	unsubscribe: (channel: string, listener: (message: string) => void) => Promise<unknown>
}

/**
 * ioredis clients for `redisBus`. A subscribed Redis connection can do
 * nothing else, so pass a second one: `ioredisPubSub(redis, redis.duplicate())`.
 */
export const ioredisPubSub = (publisher: IoredisLike, subscriber: IoredisLike): RedisPubSub => ({
	publish: (channel, message) => publisher.publish(channel, message),
	subscribe: async (channel, onMessage) => {
		const listener = (from: string, message: string) => {
			if (from === channel) onMessage(message)
		}
		subscriber.on('message', listener)
		await subscriber.subscribe(channel)
		return async () => {
			subscriber.removeListener('message', listener)
			await subscriber.unsubscribe(channel)
		}
	},
})

/**
 * node-redis clients for `redisBus`. A subscribed connection can do nothing
 * else, so pass a second one: `nodeRedisPubSub(client, client.duplicate())`
 * (both connected).
 */
export const nodeRedisPubSub = (
	publisher: NodeRedisLike,
	subscriber: NodeRedisLike
): RedisPubSub => ({
	publish: (channel, message) => publisher.publish(channel, message),
	subscribe: async (channel, onMessage) => {
		const listener = (message: string) => onMessage(message)
		await subscriber.subscribe(channel, listener)
		return () => subscriber.unsubscribe(channel, listener)
	},
})

/**
 * Redis pub/sub as the bus: a write in one process reaches the connections
 * of every other in milliseconds, and the database is not asked at all.
 * Bring your own client, e.g. `redisBus(ioredisPubSub(redis, redis.duplicate()))`.
 *
 * Pub/sub keeps nothing: a process cut off from Redis for a moment misses
 * what was sent meanwhile. So a slow database check still runs underneath,
 * every `fallbackCheckMs` (default 30 s; `false` turns it off).
 */
export const redisBus = (
	pubsub: RedisPubSub,
	{
		fallbackCheckMs = 30_000,
		prefix = 'conversations',
	}: { fallbackCheckMs?: false | number; prefix?: string } = {}
): ConversationsBus => {
	/** This process, so it skips its own messages: its connections heard them already. */
	const origin = Math.random().toString(36).slice(2)
	const fallback = fallbackCheckMs === false ? null : databaseBus({ intervalMs: fallbackCheckMs })
	const channelOf = (slug: string) => `${prefix}:${slug}`

	return {
		publish: async ({ instance, signal }) => {
			await pubsub.publish(channelOf(instance.slug), JSON.stringify({ origin, ...signal }))
		},
		subscribe: (args) => {
			const { instance, onSignals, payload } = args
			let stopped = false
			let stopRedis: (() => Promise<unknown> | unknown) | null = null
			pubsub
				.subscribe(channelOf(instance.slug), (message) => {
					try {
						const parsed = JSON.parse(message) as RealtimeSignal & { origin?: string }
						if (parsed.origin === origin || typeof parsed.key !== 'string') return
						onSignals([{ channel: parsed.channel, key: parsed.key }])
					} catch {
						// Not ours.
					}
				})
				.then((stop) => {
					if (stopped) void stop()
					else stopRedis = stop
				})
				.catch((error: unknown) => {
					payload.logger.error({ err: error, msg: '[conversations] Redis subscribe failed' })
				})
			const stopFallback = fallback?.subscribe(args)
			return () => {
				stopped = true
				void stopRedis?.()
				stopFallback?.()
			}
		},
	}
}
