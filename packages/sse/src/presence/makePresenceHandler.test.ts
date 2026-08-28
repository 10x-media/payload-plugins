import type { PayloadRequest } from 'payload'
import { inMemoryKVAdapter } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EventBroker, RealtimeEvent } from '../broker/types'
import { makePresenceHandler } from './makePresenceHandler'
import { createPresenceStore } from './store'

afterEach(() => {
	vi.restoreAllMocks()
})

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

const makeReq = (opts: {
	user?: unknown
	method?: string
	body?: unknown
	url?: string
	json?: () => Promise<unknown>
}): PayloadRequest => {
	const body = opts.body
	return {
		user: opts.user,
		method: opts.method ?? 'POST',
		url: opts.url ?? 'http://localhost/api/realtime/presence',
		json: opts.json ?? (async () => body),
		headers: new Headers(body === undefined ? {} : { 'content-type': 'application/json' }),
	} as unknown as PayloadRequest
}

describe('makePresenceHandler', () => {
	it('returns 401 for anonymous POST', async () => {
		const kv = inMemoryKVAdapter().init({} as never)
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		const handler = makePresenceHandler({
			store,
			broker: makeBroker(),
			identify: () => ({ id: 'x', label: 'x' }),
		})
		const res = await handler(makeReq({ user: undefined, body: { collection: 'posts', id: '1' } }))
		expect(res.status).toBe(401)
	})

	it('POST joins and returns peers without email', async () => {
		const kv = inMemoryKVAdapter().init({} as never)
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		const broker = makeBroker()
		const handler = makePresenceHandler({
			store,
			broker,
			identify: (user) => ({
				id: String((user as { id: string }).id),
				label: String((user as { id: string }).id),
			}),
		})

		const res = await handler(
			makeReq({
				user: { id: 'u1', email: 'a@t.dev' },
				body: { collection: 'posts', id: '1' },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { peers: unknown[] }
		expect(json.peers).toEqual([{ id: 'u1', label: 'u1' }])
		expect(JSON.stringify(json)).not.toContain('email')
		expect(broker.published).toHaveLength(1)
		expect(broker.published[0]).toMatchObject({
			topic: 'presence:posts:1',
			event: 'presence:join',
			collection: 'posts',
			docId: '1',
		})
	})

	it('second user POST sees both peers', async () => {
		const kv = inMemoryKVAdapter().init({} as never)
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		const handler = makePresenceHandler({
			store,
			broker: makeBroker(),
			identify: (user) => ({
				id: String((user as { id: string }).id),
				label: String((user as { name?: string }).name ?? (user as { id: string }).id),
			}),
		})

		await handler(
			makeReq({ user: { id: 'u1', name: 'Alice' }, body: { collection: 'posts', id: '1' } })
		)
		const res = await handler(
			makeReq({ user: { id: 'u2', name: 'Bob' }, body: { collection: 'posts', id: '1' } })
		)
		const json = (await res.json()) as { peers: Array<{ id: string }> }
		expect(json.peers.map((p) => p.id).sort()).toEqual(['u1', 'u2'])
	})

	it('DELETE leaves and publishes presence:leave', async () => {
		const kv = inMemoryKVAdapter().init({} as never)
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		const broker = makeBroker()
		const handler = makePresenceHandler({
			store,
			broker,
			identify: (user) => ({
				id: String((user as { id: string }).id),
				label: 'x',
			}),
		})

		await handler(makeReq({ user: { id: 'u1' }, body: { collection: 'posts', id: '1' } }))
		const res = await handler(
			makeReq({
				user: { id: 'u1' },
				method: 'DELETE',
				body: { collection: 'posts', id: '1' },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { peers: unknown[] }
		expect(json.peers).toEqual([])
		expect(broker.published.at(-1)).toMatchObject({
			event: 'presence:leave',
			topic: 'presence:posts:1',
		})
	})

	it('DELETE accepts collection and id from query', async () => {
		const kv = inMemoryKVAdapter().init({} as never)
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		const handler = makePresenceHandler({
			store,
			broker: makeBroker(),
			identify: (user) => ({
				id: String((user as { id: string }).id),
				label: 'x',
			}),
		})

		await handler(makeReq({ user: { id: 'u1' }, body: { collection: 'posts', id: '1' } }))
		const res = await handler(
			makeReq({
				user: { id: 'u1' },
				method: 'DELETE',
				url: 'http://localhost/api/realtime/presence?collection=posts&id=1',
				json: async () => undefined,
			})
		)
		expect(res.status).toBe(200)
		expect((await res.json()) as { peers: unknown[] }).toEqual({ peers: [] })
	})

	it('returns 400 when collection or id is missing', async () => {
		const kv = inMemoryKVAdapter().init({} as never)
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		const handler = makePresenceHandler({
			store,
			broker: makeBroker(),
			identify: () => ({ id: 'u1', label: 'u1' }),
		})
		const res = await handler(makeReq({ user: { id: 'u1' }, body: { collection: 'posts' } }))
		expect(res.status).toBe(400)
	})

	it('does not fail the response when broker.publish throws', async () => {
		const kv = inMemoryKVAdapter().init({} as never)
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		const broker = makeBroker()
		broker.publish = () => {
			throw new Error('boom')
		}
		const handler = makePresenceHandler({
			store,
			broker,
			identify: () => ({ id: 'u1', label: 'u1' }),
		})
		const res = await handler(
			makeReq({ user: { id: 'u1' }, body: { collection: 'posts', id: '1' } })
		)
		expect(res.status).toBe(200)
	})
})
