import type { PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EventBroker, RealtimeEvent } from '../broker/types'
import { makeStreamHandler } from './makeStreamHandler'

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

const decodeChunks = async (res: Response, signal?: AbortSignal): Promise<string> => {
	const reader = res.body?.getReader()
	if (!reader) throw new Error('missing body')
	const decoder = new TextDecoder()
	let out = ''
	const read = async (): Promise<void> => {
		while (true) {
			if (signal?.aborted) {
				await reader.cancel()
				return
			}
			const { done, value } = await reader.read()
			if (done) return
			out += decoder.decode(value, { stream: true })
		}
	}
	await Promise.race([
		read(),
		signal
			? new Promise<void>((resolve) => {
					signal.addEventListener('abort', () => resolve(), { once: true })
				})
			: new Promise<void>(() => undefined),
	])
	return out
}

const makeBroker = (): EventBroker & {
	subscribe: ReturnType<typeof vi.fn>
	unsubscribes: Array<ReturnType<typeof vi.fn>>
} => {
	const unsubscribes: Array<ReturnType<typeof vi.fn>> = []
	const subscribe = vi.fn((_topic: string, _cb: (event: RealtimeEvent) => void) => {
		const unsub = vi.fn()
		unsubscribes.push(unsub)
		return unsub
	})
	return {
		publish: vi.fn(),
		subscribe,
		destroy: vi.fn(async () => undefined),
		unsubscribes,
	}
}

const authReq = (opts: {
	user?: unknown
	url?: string
	signal?: AbortSignal
	collections?: Record<string, { config: { slug: string; access?: { read?: () => unknown } } }>
}): PayloadRequest => {
	const url = opts.url ?? 'http://localhost/api/realtime/stream?topics=posts'
	return {
		user: opts.user,
		url,
		payload: {
			collections: opts.collections ?? {
				posts: { config: { slug: 'posts', access: { read: () => true } } },
			},
			count: vi.fn(async () => ({ totalDocs: 0 })),
		},
		...(opts.signal ? { signal: opts.signal } : {}),
	} as unknown as PayloadRequest
}

describe('makeStreamHandler', () => {
	it('returns 401 for an anonymous request', async () => {
		const handler = makeStreamHandler({
			broker: makeBroker(),
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 15_000,
		})
		const res = await handler(authReq({ user: undefined }))
		expect(res.status).toBe(401)
	})

	it('streams retry, ready, heartbeats, and clears the interval on abort', async () => {
		vi.useFakeTimers()
		const broker = makeBroker()
		const handler = makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 1000,
		})
		const ac = new AbortController()
		const res = await handler(
			authReq({
				user: { id: '1' },
				url: 'http://localhost/api/realtime/stream?topics=posts',
				signal: ac.signal,
			})
		)
		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
		expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform')
		expect(res.headers.get('Connection')).toBe('keep-alive')
		expect(res.headers.get('X-Accel-Buffering')).toBe('no')

		const reader = res.body?.getReader()
		if (!reader) throw new Error('missing body')
		const decoder = new TextDecoder()
		let buf = ''

		const readUntil = async (predicate: (s: string) => boolean) => {
			while (!predicate(buf)) {
				const { done, value } = await reader.read()
				if (done) break
				buf += decoder.decode(value, { stream: true })
			}
		}

		await readUntil((s) => s.includes('event: ready'))
		expect(buf).toContain('retry: 3000')
		expect(buf).toContain('event: ready')
		expect(buf).toContain('"topic":"posts"')

		const heartbeatPromise = readUntil((s) => s.includes(': heartbeat'))
		await vi.advanceTimersByTimeAsync(1000)
		await heartbeatPromise
		expect(buf).toContain(': heartbeat')

		const timersBeforeAbort = vi.getTimerCount()
		expect(timersBeforeAbort).toBeGreaterThan(0)
		ac.abort()
		await Promise.resolve()
		expect(vi.getTimerCount()).toBeLessThan(timersBeforeAbort)
		expect(broker.unsubscribes.every((u) => u.mock.calls.length >= 1)).toBe(true)
	})

	it('calls unsubscribe on abort', async () => {
		vi.useFakeTimers()
		const broker = makeBroker()
		const handler = makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
		})
		const ac = new AbortController()
		const res = await handler(
			authReq({
				user: { id: '1' },
				signal: ac.signal,
			})
		)
		expect(res.status).toBe(200)
		expect(broker.subscribe).toHaveBeenCalledWith('posts', expect.any(Function))

		const drain = decodeChunks(res, ac.signal)
		ac.abort()
		await drain
		expect(broker.unsubscribes[0]).toHaveBeenCalled()
	})
})
