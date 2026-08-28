import type { Payload, PayloadRequest } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventBroker, RealtimeEvent } from '../broker/types'
import { getRuntime, type SSERuntime, setRuntime } from '../plugin/runtime'
import { createAfterChangeHook, SSE_SKIP } from './createAfterChangeHook'

const makeBroker = (): EventBroker & { published: RealtimeEvent[] } => {
	const published: RealtimeEvent[] = []
	return {
		published,
		publish: (event) => {
			published.push(event)
		},
		subscribe: () => () => {},
		destroy: async () => {},
	}
}

const makePayload = (): Payload => ({}) as Payload

const makeRuntime = (broker: EventBroker): SSERuntime => ({
	broker,
	collections: { posts: { thinEvents: true, events: ['create', 'update', 'delete'] } },
	heartbeatMs: 15_000,
	presence: false,
	scope: false,
	destroy: async () => {},
	emit: (event) => {
		try {
			broker.publish(event)
		} catch {
			// emit must never throw
		}
	},
})

describe('createAfterChangeHook', () => {
	let broker: ReturnType<typeof makeBroker>
	let payload: Payload

	beforeEach(() => {
		broker = makeBroker()
		payload = makePayload()
		setRuntime(payload, makeRuntime(broker))
	})

	it('publishes thin create events to list and doc topics', async () => {
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create', 'update'] })
		const doc = { id: 'abc', title: 'Hello' }
		const req = { payload, context: {} } as unknown as PayloadRequest

		const result = await hook({
			doc,
			operation: 'create',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(result).toBe(doc)
		expect(broker.published).toHaveLength(2)
		const topics = broker.published.map((e) => e.topic).sort()
		expect(topics).toEqual(['posts', 'posts:abc'])
		for (const event of broker.published) {
			expect(event.event).toBe('create')
			expect(event.collection).toBe('posts')
			expect(event.docId).toBe('abc')
			expect(event.operation).toBe('create')
			expect(event.data).toBeUndefined()
			expect(typeof event.id).toBe('string')
			expect(typeof event.timestamp).toBe('number')
		}
	})

	it('publishes update when update is in events', async () => {
		const hook = createAfterChangeHook({ collection: 'posts', events: ['update'] })
		const doc = { id: 42, title: 'X' }
		const req = { payload, context: {} } as unknown as PayloadRequest

		await hook({
			doc,
			operation: 'update',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(broker.published).toHaveLength(2)
		expect(broker.published[0]?.operation).toBe('update')
		expect(broker.published.map((e) => e.topic).sort()).toEqual(['posts', 'posts:42'])
	})

	it('skips when operation is not in events', async () => {
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create'] })
		const doc = { id: '1' }
		const req = { payload, context: {} } as unknown as PayloadRequest

		await hook({
			doc,
			operation: 'update',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(broker.published).toHaveLength(0)
	})

	it('skips when SSE_SKIP is set on req.context', async () => {
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create', 'update'] })
		const doc = { id: '1' }
		const req = { payload, context: { [SSE_SKIP]: true } } as unknown as PayloadRequest

		await hook({
			doc,
			operation: 'create',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(broker.published).toHaveLength(0)
	})

	it('skips when req.query.autosave is truthy', async () => {
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create', 'update'] })
		const doc = { id: '1' }
		const req = {
			payload,
			context: {},
			query: { autosave: 'true' },
		} as unknown as PayloadRequest

		const result = await hook({
			doc,
			operation: 'update',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(result).toBe(doc)
		expect(broker.published).toHaveLength(0)
	})

	it('returns doc when publish throws', async () => {
		broker.publish = () => {
			throw new Error('boom')
		}
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create'] })
		const doc = { id: '1' }
		const req = { payload, context: {} } as unknown as PayloadRequest

		const result = await hook({
			doc,
			operation: 'create',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(result).toBe(doc)
	})

	it('no-ops when runtime is missing', async () => {
		const bare = makePayload()
		expect(getRuntime(bare)).toBeUndefined()
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create'] })
		const doc = { id: '1' }
		const req = { payload: bare, context: {} } as unknown as PayloadRequest

		const result = await hook({
			doc,
			operation: 'create',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(result).toBe(doc)
		expect(broker.published).toHaveLength(0)
	})

	it('publishes scoped wide topics plus an unscoped doc topic', async () => {
		setRuntime(payload, {
			...makeRuntime(broker),
			scope: {
				resolveRequest: () => 't1',
				resolveDoc: () => 't1',
			},
		})
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create'] })
		const doc = { id: 'abc', title: 'Hello' }
		const req = { payload, context: {} } as unknown as PayloadRequest

		await hook({
			doc,
			operation: 'create',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		const topics = broker.published.map((e) => e.topic).sort()
		expect(topics).toEqual(['*::posts', 'posts:abc', 't1::posts'])
		for (const event of broker.published) {
			expect(event.scope).toBe('t1')
			expect(event.collection).toBe('posts')
			expect(event.docId).toBe('abc')
		}
	})

	it('logs when the broker throws and still lets the write succeed', async () => {
		const error = vi.fn()
		const payload = { logger: { error } } as unknown as Payload
		const broker = {
			publish: vi.fn().mockImplementation(() => {
				throw new Error('bus down')
			}),
			subscribe: vi.fn(),
		}
		setRuntime(payload, makeRuntime(broker as never))
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create'] })
		const req = { payload, context: {} } as unknown as PayloadRequest

		await expect(
			hook({
				doc: { id: 'abc' },
				operation: 'create',
				req,
				collection: { slug: 'posts' },
			} as Parameters<typeof hook>[0]),
		).resolves.toEqual({ id: 'abc' })

		expect(error).toHaveBeenCalled()
	})

	it('skips collection-wide publish when resolveDoc returns null', async () => {
		setRuntime(payload, {
			...makeRuntime(broker),
			scope: {
				resolveRequest: () => 't1',
				resolveDoc: () => null,
			},
		})
		const hook = createAfterChangeHook({ collection: 'posts', events: ['create'] })
		const req = { payload, context: {} } as unknown as PayloadRequest

		await hook({
			doc: { id: 'abc' },
			operation: 'create',
			req,
			collection: { slug: 'posts' },
		} as Parameters<typeof hook>[0])

		expect(broker.published.map((e) => e.topic)).toEqual(['posts:abc'])
	})
})
