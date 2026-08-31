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
	readAccess?: boolean | (() => unknown)
	countTotalDocs?: number
	payloadCollections?: Record<string, { config: { slug: string; access?: { read?: unknown } } }>
}): PayloadRequest => {
	const body = opts.body
	const slug = 'posts'
	const readAccess = opts.readAccess ?? true
	return {
		user: opts.user,
		method: opts.method ?? 'POST',
		url: opts.url ?? 'http://localhost/api/realtime/presence',
		json: opts.json ?? (async () => body),
		headers: new Headers(body === undefined ? {} : { 'content-type': 'application/json' }),
		payload: {
			collections: opts.payloadCollections ?? {
				[slug]: {
					config: {
						slug,
						access: { read: typeof readAccess === 'function' ? readAccess : readAccess },
					},
				},
			},
			count: vi.fn(async () => ({ totalDocs: opts.countTotalDocs ?? 0 })),
		},
	} as unknown as PayloadRequest
}

const defaultDeps = (overrides?: Partial<Parameters<typeof makePresenceHandler>[0]>) => {
	const kv = inMemoryKVAdapter().init({} as never)
	const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
	return {
		store,
		broker: makeBroker(),
		identify: () => ({ id: 'u1', label: 'u1' }),
		collections: { posts: { thinEvents: true } },
		...overrides,
	}
}

describe('makePresenceHandler', () => {
	it('returns 401 for anonymous POST', async () => {
		const handler = makePresenceHandler(defaultDeps({ identify: () => ({ id: 'x', label: 'x' }) }))
		const res = await handler(makeReq({ user: undefined, body: { collection: 'posts', id: '1' } }))
		expect(res.status).toBe(401)
	})

	it('returns 403 when access.read is false', async () => {
		const handler = makePresenceHandler(defaultDeps())
		const res = await handler(
			makeReq({
				user: { id: 'u1' },
				body: { collection: 'posts', id: '1' },
				readAccess: false,
			})
		)
		expect(res.status).toBe(403)
	})

	it('returns 403 when Where access does not own the id', async () => {
		const handler = makePresenceHandler(defaultDeps())
		const res = await handler(
			makeReq({
				user: { id: 'u1' },
				body: { collection: 'posts', id: 'unowned' },
				readAccess: () => ({ owner: { equals: 'me' } }),
				countTotalDocs: 0,
			})
		)
		expect(res.status).toBe(403)
	})

	it('returns 403 for a collection not opted into the plugin', async () => {
		const handler = makePresenceHandler(defaultDeps({ collections: {} }))
		const res = await handler(
			makeReq({
				user: { id: 'u1' },
				body: { collection: 'posts', id: '1' },
			})
		)
		expect(res.status).toBe(403)
	})

	it('POST joins and returns peers without email', async () => {
		const broker = makeBroker()
		const handler = makePresenceHandler(
			defaultDeps({
				broker,
				identify: (user) => ({
					id: String((user as { id: string }).id),
					label: String((user as { id: string }).id),
				}),
			})
		)

		const res = await handler(
			makeReq({
				user: { id: 'u1', email: 'a@t.dev' },
				body: { collection: 'posts', id: '1' },
			})
		)
		expect(res.status).toBe(200)
		const json = (await res.json()) as { peers: unknown[] }
		expect(json.peers).toEqual([{ id: 'u1', label: 'u1', mode: 'viewing' }])
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
		const handler = makePresenceHandler(
			defaultDeps({
				identify: (user) => ({
					id: String((user as { id: string }).id),
					label: String((user as { name?: string }).name ?? (user as { id: string }).id),
				}),
			})
		)

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
		const broker = makeBroker()
		const handler = makePresenceHandler(
			defaultDeps({
				broker,
				identify: (user) => ({
					id: String((user as { id: string }).id),
					label: 'x',
				}),
			})
		)

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
		const handler = makePresenceHandler(
			defaultDeps({
				identify: (user) => ({
					id: String((user as { id: string }).id),
					label: 'x',
				}),
			})
		)

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
		const handler = makePresenceHandler(defaultDeps())
		const res = await handler(makeReq({ user: { id: 'u1' }, body: { collection: 'posts' } }))
		expect(res.status).toBe(400)
	})

	it('does not fail the response when broker.publish throws', async () => {
		const broker = makeBroker()
		broker.publish = () => {
			throw new Error('boom')
		}
		const handler = makePresenceHandler(defaultDeps({ broker }))
		const res = await handler(
			makeReq({ user: { id: 'u1' }, body: { collection: 'posts', id: '1' } })
		)
		expect(res.status).toBe(200)
	})

	it('POST without mode returns viewing and POST editing publishes mode', async () => {
		const broker = makeBroker()
		const handler = makePresenceHandler(
			defaultDeps({
				broker,
				identify: (user) => ({
					id: String((user as { id: string }).id),
					label: String((user as { id: string }).id),
				}),
			})
		)

		const join = await handler(
			makeReq({ user: { id: 'u1' }, body: { collection: 'posts', id: '1' } })
		)
		expect(((await join.json()) as { peers: Array<{ mode: string }> }).peers).toEqual([
			{ id: 'u1', label: 'u1', mode: 'viewing' },
		])

		const edit = await handler(
			makeReq({
				user: { id: 'u1' },
				body: { collection: 'posts', id: '1', mode: 'editing' },
			})
		)
		const edited = (await edit.json()) as { peers: Array<{ mode: string }> }
		expect(edited.peers).toEqual([{ id: 'u1', label: 'u1', mode: 'editing' }])
		expect(broker.published.at(-1)?.data).toEqual({
			peers: [{ id: 'u1', label: 'u1', mode: 'editing' }],
		})
	})

	it('POST heartbeat without mode keeps editing', async () => {
		const handler = makePresenceHandler(
			defaultDeps({
				identify: (user) => ({
					id: String((user as { id: string }).id),
					label: 'x',
				}),
			})
		)
		await handler(
			makeReq({
				user: { id: 'u1' },
				body: { collection: 'posts', id: '1', mode: 'editing' },
			})
		)
		const res = await handler(
			makeReq({ user: { id: 'u1' }, body: { collection: 'posts', id: '1' } })
		)
		expect(((await res.json()) as { peers: Array<{ mode: string }> }).peers[0]?.mode).toBe(
			'editing'
		)
	})
})
