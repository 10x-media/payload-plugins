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
	findByID?: ReturnType<typeof vi.fn>
	count?: ReturnType<typeof vi.fn>
	readAccess?: boolean | (() => unknown)
	collections?: Record<string, { config: { slug: string; access?: { read?: unknown } } }>
}): PayloadRequest => {
	const url = opts.url ?? 'http://localhost/api/realtime/stream?topics=posts'
	const read = opts.readAccess ?? (() => true)
	return {
		user: opts.user,
		url,
		payload: {
			collections: opts.collections ?? {
				posts: { config: { slug: 'posts', access: { read } } },
			},
			count: opts.count ?? vi.fn(async () => ({ totalDocs: 0 })),
			findByID: opts.findByID ?? vi.fn(async () => null),
			logger: { error: vi.fn(), warn: vi.fn() },
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

	it('enriches events when topic mode is enriched and findByID returns a doc', async () => {
		const listeners = new Map<string, (event: RealtimeEvent) => void>()
		const broker: EventBroker = {
			publish: vi.fn(),
			subscribe: (topic, cb) => {
				listeners.set(topic, cb)
				return vi.fn()
			},
			destroy: vi.fn(async () => undefined),
		}
		const doc = { id: 'p1', title: 'hello' }
		const findByID = vi.fn(async () => doc)
		const ac = new AbortController()
		const res = await makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: false } },
			heartbeatMs: 60_000,
		})(
			authReq({
				user: { id: '1' },
				signal: ac.signal,
				findByID,
			})
		)
		expect(res.status).toBe(200)

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

		listeners.get('posts')?.({
			id: '1',
			topic: 'posts',
			event: 'update',
			collection: 'posts',
			docId: 'p1',
			operation: 'update',
			timestamp: 1,
		})

		await readUntil((s) => s.includes('"operation":"update"'))
		expect(buf).toContain('"doc"')
		expect(buf).toContain('"title":"hello"')
		expect(findByID).toHaveBeenCalled()
		ac.abort()
		await reader.cancel().catch(() => {})
	})

	it('keeps thin frames when topic mode is thin', async () => {
		const listeners = new Map<string, (event: RealtimeEvent) => void>()
		const broker: EventBroker = {
			publish: vi.fn(),
			subscribe: (topic, cb) => {
				listeners.set(topic, cb)
				return vi.fn()
			},
			destroy: vi.fn(async () => undefined),
		}
		const findByID = vi.fn(async () => ({ id: 'p1' }))
		const ac = new AbortController()
		const res = await makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
		})(
			authReq({
				user: { id: '1' },
				signal: ac.signal,
				findByID,
			})
		)
		expect(res.status).toBe(200)

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

		listeners.get('posts')?.({
			id: '1',
			topic: 'posts',
			event: 'update',
			collection: 'posts',
			docId: 'p1',
			operation: 'update',
			timestamp: 1,
		})

		await readUntil((s) => s.includes('"operation":"update"'))
		expect(buf).not.toContain('"doc"')
		expect(findByID).not.toHaveBeenCalled()
		ac.abort()
		await reader.cancel().catch(() => {})
	})

	it('serializes overlapping enrichForUser so frames enqueue in publish order', async () => {
		const listeners = new Map<string, (event: RealtimeEvent) => void>()
		const broker: EventBroker = {
			publish: vi.fn(),
			subscribe: (topic, cb) => {
				listeners.set(topic, cb)
				return vi.fn()
			},
			destroy: vi.fn(async () => undefined),
		}

		let releaseFirst: (() => void) | undefined
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		const findByID = vi.fn(async ({ id }: { id: string }) => {
			if (id === 'slow') {
				await firstGate
				return { id: 'slow', title: 'first' }
			}
			return { id: 'fast', title: 'second' }
		})

		const ac = new AbortController()
		const res = await makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: false } },
			heartbeatMs: 60_000,
		})(
			authReq({
				user: { id: '1' },
				signal: ac.signal,
				findByID,
			})
		)
		expect(res.status).toBe(200)

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

		listeners.get('posts')?.({
			id: '1',
			topic: 'posts',
			event: 'update',
			collection: 'posts',
			docId: 'slow',
			operation: 'update',
			timestamp: 1,
		})
		listeners.get('posts')?.({
			id: '2',
			topic: 'posts',
			event: 'update',
			collection: 'posts',
			docId: 'fast',
			operation: 'update',
			timestamp: 2,
		})

		await Promise.resolve()
		expect(findByID).toHaveBeenCalled()
		releaseFirst?.()

		await readUntil((s) => s.includes('"title":"second"'))
		const firstIdx = buf.indexOf('"title":"first"')
		const secondIdx = buf.indexOf('"title":"second"')
		expect(firstIdx).toBeGreaterThan(-1)
		expect(secondIdx).toBeGreaterThan(firstIdx)

		ac.abort()
		await reader.cancel().catch(() => {})
	})

	it('subscribes to scoped broker channels and rewrites the public topic', async () => {
		const listeners = new Map<string, (event: RealtimeEvent) => void>()
		const broker: EventBroker = {
			publish: vi.fn(),
			subscribe: (topic, cb) => {
				listeners.set(topic, cb)
				return vi.fn()
			},
			destroy: vi.fn(async () => undefined),
		}
		const ac = new AbortController()
		const res = await makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
			scope: { resolveRequest: () => 't1', resolveDoc: () => 't1' },
		})(authReq({ user: { id: '1' }, signal: ac.signal }))

		expect(res.status).toBe(200)
		expect([...listeners.keys()]).toEqual(['t1::posts'])

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

		listeners.get('t1::posts')?.({
			id: '1',
			topic: 't1::posts',
			event: 'update',
			collection: 'posts',
			docId: 'p1',
			operation: 'update',
			timestamp: 1,
			scope: 't1',
		})
		await readUntil((s) => s.includes('"operation":"update"'))
		expect(buf).toContain('"topic":"posts"')
		expect(buf).not.toContain('"topic":"t1::posts"')
		ac.abort()
		await reader.cancel().catch(() => {})
	})

	it('drops gated thin events the subscriber cannot read and delivers deletes without docId or actorId', async () => {
		const listeners = new Map<string, (event: RealtimeEvent) => void>()
		const broker: EventBroker = {
			publish: vi.fn(),
			subscribe: (topic, cb) => {
				listeners.set(topic, cb)
				return vi.fn()
			},
			destroy: vi.fn(async () => undefined),
		}
		const count = vi.fn(async ({ where }: { where?: { id?: { equals?: string } } }) => ({
			totalDocs: where?.id?.equals === 'owned' ? 1 : 0,
		}))
		const ac = new AbortController()
		const res = await makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
			scope: { resolveRequest: () => 't1', resolveDoc: () => 't1' },
		})(
			authReq({
				user: { id: '1' },
				signal: ac.signal,
				readAccess: () => ({ owner: { equals: 'me' } }),
				count,
			})
		)
		expect(res.status).toBe(200)

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

		const emit = (event: RealtimeEvent) => listeners.get('t1::posts')?.(event)
		emit({
			id: '1',
			topic: 't1::posts',
			event: 'update',
			collection: 'posts',
			docId: 'other',
			operation: 'update',
			timestamp: 1,
		})
		emit({
			id: '2',
			topic: 't1::posts',
			event: 'update',
			collection: 'posts',
			docId: 'owned',
			operation: 'update',
			timestamp: 2,
		})
		emit({
			id: '1717000000000:posts:gone:delete:t1::posts',
			topic: 't1::posts',
			event: 'delete',
			collection: 'posts',
			docId: 'gone',
			operation: 'delete',
			timestamp: 1_717_000_000_000,
			actorId: 'u1',
		})

		await readUntil((s) => s.includes('"operation":"delete"'))
		const deleteFrame = buf.split('\n\n').find((chunk) => chunk.includes('"operation":"delete"'))
		expect(deleteFrame).toBeDefined()
		expect(deleteFrame).not.toContain('gone')
		expect(deleteFrame).not.toContain('u1')
		expect(deleteFrame).not.toContain('actorId')
		expect(buf).toContain('"docId":"owned"')
		expect(buf).not.toContain('"docId":"other"')
		ac.abort()
		await reader.cancel().catch(() => {})
	})

	it('drops gated enriched events when findByID denies', async () => {
		const listeners = new Map<string, (event: RealtimeEvent) => void>()
		const broker: EventBroker = {
			publish: vi.fn(),
			subscribe: (topic, cb) => {
				listeners.set(topic, cb)
				return vi.fn()
			},
			destroy: vi.fn(async () => undefined),
		}
		const findByID = vi.fn(async () => {
			throw new Error('forbidden')
		})
		const ac = new AbortController()
		const res = await makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: false } },
			heartbeatMs: 60_000,
			scope: { resolveRequest: () => 't1', resolveDoc: () => 't1' },
		})(
			authReq({
				user: { id: '1' },
				signal: ac.signal,
				readAccess: () => ({ owner: { equals: 'me' } }),
				findByID,
			})
		)

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

		listeners.get('t1::posts')?.({
			id: '1',
			topic: 't1::posts',
			event: 'update',
			collection: 'posts',
			docId: 'secret',
			operation: 'update',
			timestamp: 1,
		})
		await Promise.resolve()
		await Promise.resolve()
		expect(buf).not.toContain('"docId":"secret"')
		expect(buf).not.toContain('"operation":"update"')
		ac.abort()
		await reader.cancel().catch(() => {})
	})

	it('returns 429 when the same user exceeds maxConnectionsPerUser', async () => {
		const handler = makeStreamHandler({
			broker: makeBroker(),
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
			maxConnectionsPerUser: 1,
		})
		const firstAc = new AbortController()
		const first = await handler(authReq({ user: { id: 'cap-user' }, signal: firstAc.signal }))
		expect(first.status).toBe(200)

		const second = await handler(authReq({ user: { id: 'cap-user' } }))
		expect(second.status).toBe(429)

		firstAc.abort()
		await first.body?.cancel().catch(() => {})
	})

	it('releases a slot so a later connect succeeds after abort', async () => {
		const handler = makeStreamHandler({
			broker: makeBroker(),
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
			maxConnectionsPerUser: 1,
		})
		const firstAc = new AbortController()
		const first = await handler(authReq({ user: { id: 'cap-user-2' }, signal: firstAc.signal }))
		expect(first.status).toBe(200)
		firstAc.abort()
		await first.body?.cancel().catch(() => {})

		const thirdAc = new AbortController()
		const third = await handler(authReq({ user: { id: 'cap-user-2' }, signal: thirdAc.signal }))
		expect(third.status).toBe(200)
		thirdAc.abort()
		await third.body?.cancel().catch(() => {})
	})

	it('dedupes duplicate topics before subscribe', async () => {
		const broker = makeBroker()
		const ac = new AbortController()
		const res = await makeStreamHandler({
			broker,
			collections: { posts: { thinEvents: true } },
			heartbeatMs: 60_000,
		})(
			authReq({
				user: { id: '1' },
				signal: ac.signal,
				url: 'http://localhost/api/realtime/stream?topics=posts,posts,posts',
			})
		)
		expect(res.status).toBe(200)
		expect(broker.subscribe).toHaveBeenCalledTimes(1)
		expect(broker.subscribe).toHaveBeenCalledWith('posts', expect.any(Function))
		ac.abort()
		await res.body?.cancel().catch(() => {})
	})
})
