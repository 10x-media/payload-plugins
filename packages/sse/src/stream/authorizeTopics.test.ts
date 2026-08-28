import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { authorizeTopics } from './authorizeTopics'

type FakeCollection = {
	config: {
		slug: string
		access?: {
			read?: boolean | ((args: { req: PayloadRequest }) => unknown)
		}
	}
}

const makeReq = (opts: {
	collections?: Record<string, FakeCollection>
	count?: (args: { where?: unknown }) => Promise<{ totalDocs: number }>
}): PayloadRequest =>
	({
		payload: {
			collections: opts.collections ?? {},
			count: opts.count ?? (async () => ({ totalDocs: 0 })),
		},
	}) as unknown as PayloadRequest

describe('authorizeTopics', () => {
	it('returns 400 for an empty topics list', async () => {
		const result = await authorizeTopics({
			req: makeReq({}),
			topics: [],
			collections: {},
		})
		expect(result).toEqual({ ok: false, status: 400, message: expect.any(String) })
	})

	it('returns 400 when more than 32 topics are requested', async () => {
		const topics = Array.from({ length: 33 }, (_, i) => `posts:${i}`)
		const result = await authorizeTopics({
			req: makeReq({
				collections: {
					posts: { config: { slug: 'posts', access: { read: () => true } } },
				},
			}),
			topics,
			collections: { posts: { thinEvents: true } },
		})
		expect(result).toEqual({ ok: false, status: 400, message: expect.any(String) })
	})

	it('returns 403 for an unknown collection slug', async () => {
		const result = await authorizeTopics({
			req: makeReq({ collections: {} }),
			topics: ['missing'],
			collections: {},
		})
		expect(result).toEqual({ ok: false, status: 403, message: expect.any(String) })
	})

	it('returns 403 when access.read returns false', async () => {
		const result = await authorizeTopics({
			req: makeReq({
				collections: {
					posts: { config: { slug: 'posts', access: { read: () => false } } },
				},
			}),
			topics: ['posts'],
			collections: { posts: { thinEvents: true } },
		})
		expect(result).toEqual({ ok: false, status: 403, message: expect.any(String) })
	})

	it('returns 403 when access.read is the boolean false', async () => {
		const result = await authorizeTopics({
			req: makeReq({
				collections: {
					posts: { config: { slug: 'posts', access: { read: false } } },
				},
			}),
			topics: ['posts'],
			collections: { posts: { thinEvents: true } },
		})
		expect(result).toEqual({ ok: false, status: 403, message: expect.any(String) })
	})

	it('authorizes {slug} and {slug}:{id} when access.read returns true', async () => {
		const result = await authorizeTopics({
			req: makeReq({
				collections: {
					posts: { config: { slug: 'posts', access: { read: () => true } } },
				},
			}),
			topics: ['posts', 'posts:abc'],
			collections: { posts: { thinEvents: true } },
		})
		expect(result).toEqual({
			ok: true,
			topics: [
				{ topic: 'posts', collection: 'posts', mode: 'thin' },
				{ topic: 'posts:abc', collection: 'posts', docId: 'abc', mode: 'thin' },
			],
		})
	})

	it('refuses Where-scoped {slug}, allows owned {slug}:{id}, refuses unowned', async () => {
		const where = { owner: { equals: 'me' } }
		const count = vi.fn(async (args: { where?: unknown }) => {
			const whereJson = JSON.stringify(args.where)
			return { totalDocs: whereJson.includes('"abc"') ? 1 : 0 }
		})
		const req = makeReq({
			collections: {
				posts: { config: { slug: 'posts', access: { read: () => where } } },
			},
			count,
		})

		const refuseWide = await authorizeTopics({
			req,
			topics: ['posts'],
			collections: { posts: { thinEvents: true } },
		})
		expect(refuseWide).toEqual({ ok: false, status: 403, message: expect.any(String) })

		const owned = await authorizeTopics({
			req,
			topics: ['posts:abc'],
			collections: { posts: { thinEvents: true } },
		})
		expect(owned).toEqual({
			ok: true,
			topics: [{ topic: 'posts:abc', collection: 'posts', docId: 'abc', mode: 'thin' }],
		})
		expect(count).toHaveBeenCalled()

		const unowned = await authorizeTopics({
			req,
			topics: ['posts:other'],
			collections: { posts: { thinEvents: true } },
		})
		expect(unowned).toEqual({ ok: false, status: 403, message: expect.any(String) })
	})

	it('returns 403 for malformed topics', async () => {
		const req = makeReq({
			collections: {
				posts: { config: { slug: 'posts', access: { read: () => true } } },
			},
		})
		const collections = { posts: { thinEvents: true } }

		for (const topic of ['posts:a:b', ':id', '', 'posts:']) {
			const result = await authorizeTopics({ req, topics: [topic], collections })
			expect(result, topic).toEqual({ ok: false, status: 403, message: expect.any(String) })
		}
	})

	it('sets mode to enriched when thinEvents is false', async () => {
		const result = await authorizeTopics({
			req: makeReq({
				collections: {
					posts: { config: { slug: 'posts', access: { read: () => true } } },
				},
			}),
			topics: ['posts'],
			collections: { posts: { thinEvents: false } },
		})
		expect(result).toEqual({
			ok: true,
			topics: [{ topic: 'posts', collection: 'posts', mode: 'enriched' }],
		})
	})

	it('allows when access.read is missing', async () => {
		const result = await authorizeTopics({
			req: makeReq({
				collections: {
					posts: { config: { slug: 'posts' } },
				},
			}),
			topics: ['posts'],
			collections: { posts: { thinEvents: true } },
		})
		expect(result).toEqual({
			ok: true,
			topics: [{ topic: 'posts', collection: 'posts', mode: 'thin' }],
		})
	})
})
