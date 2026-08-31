import { inMemoryKVAdapter } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { createPresenceStore } from './store'

const makeKv = () => inMemoryKVAdapter().init({} as never)

describe('createPresenceStore', () => {
	it('join then get lists the peer', async () => {
		const kv = makeKv()
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } })
		expect(await store.get({ collection: 'posts', id: '1' })).toEqual([
			{ id: 'u1', label: 'Alice', mode: 'viewing', expiresAt: 31_000 },
		])
	})

	it('join upserts a second user alongside the first', async () => {
		const kv = makeKv()
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u2', label: 'Bob' } })
		expect(await store.get({ collection: 'posts', id: '1' })).toEqual([
			{ id: 'u1', label: 'Alice', mode: 'viewing', expiresAt: 31_000 },
			{ id: 'u2', label: 'Bob', mode: 'viewing', expiresAt: 31_000 },
		])
	})

	it('heartbeat refreshes expiresAt for an existing peer', async () => {
		const kv = makeKv()
		let now = 1_000
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => now })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } })
		now = 10_000
		await store.heartbeat({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } })
		expect(await store.get({ collection: 'posts', id: '1' })).toEqual([
			{ id: 'u1', label: 'Alice', mode: 'viewing', expiresAt: 40_000 },
		])
	})

	it('get prunes expired peers and deletes the key when empty', async () => {
		const kv = makeKv()
		let now = 1_000
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => now })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } })
		now = 31_000
		expect(await store.get({ collection: 'posts', id: '1' })).toEqual([])
		expect(await kv.get('sse:presence:posts:1')).toBeNull()
	})

	it('leave removes a peer and deletes the key when empty', async () => {
		const kv = makeKv()
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u2', label: 'Bob' } })
		await store.leave({ collection: 'posts', id: '1', peerId: 'u1' })
		expect(await store.get({ collection: 'posts', id: '1' })).toEqual([
			{ id: 'u2', label: 'Bob', mode: 'viewing', expiresAt: 31_000 },
		])
		await store.leave({ collection: 'posts', id: '1', peerId: 'u2' })
		expect(await store.get({ collection: 'posts', id: '1' })).toEqual([])
		expect(await kv.get('sse:presence:posts:1')).toBeNull()
	})

	it('overlapping joins on the same document keep both peers', async () => {
		const data = new Map<string, unknown>()
		const kv = {
			get: async (key: string) => {
				await new Promise((resolve) => setTimeout(resolve, 5))
				return data.get(key) ?? null
			},
			set: async (key: string, value: unknown) => {
				data.set(key, value)
			},
			delete: async (key: string) => {
				data.delete(key)
			},
			has: async (key: string) => data.has(key),
			keys: async () => [...data.keys()],
			clear: async () => {
				data.clear()
			},
		}
		const store = createPresenceStore(kv as never, { leaseMs: 30_000, now: () => 1_000 })

		await Promise.all([
			store.join({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } }),
			store.join({ collection: 'posts', id: '1', peer: { id: 'u2', label: 'Bob' } }),
		])

		const peers = await store.get({ collection: 'posts', id: '1' })
		expect(peers.map((peer) => peer.id).sort()).toEqual(['u1', 'u2'])
	})

	it('never calls kv.keys', async () => {
		const kv = makeKv()
		const keys = vi.spyOn(kv, 'keys')
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'A' } })
		await store.heartbeat({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'A' } })
		await store.get({ collection: 'posts', id: '1' })
		await store.leave({ collection: 'posts', id: '1', peerId: 'u1' })
		expect(keys).not.toHaveBeenCalled()
	})

	it('join defaults mode to viewing', async () => {
		const kv = makeKv()
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		await store.join({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } })
		expect(await store.get({ collection: 'posts', id: '1' })).toEqual([
			{ id: 'u1', label: 'Alice', mode: 'viewing', expiresAt: 31_000 },
		])
	})

	it('join with editing sets mode', async () => {
		const kv = makeKv()
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		await store.join({
			collection: 'posts',
			id: '1',
			peer: { id: 'u1', label: 'Alice', mode: 'editing' },
		})
		expect((await store.get({ collection: 'posts', id: '1' }))[0]?.mode).toBe('editing')
	})

	it('heartbeat without mode keeps editing', async () => {
		const kv = makeKv()
		let now = 1_000
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => now })
		await store.join({
			collection: 'posts',
			id: '1',
			peer: { id: 'u1', label: 'Alice', mode: 'editing' },
		})
		now = 10_000
		await store.heartbeat({ collection: 'posts', id: '1', peer: { id: 'u1', label: 'Alice' } })
		expect(await store.get({ collection: 'posts', id: '1' })).toEqual([
			{ id: 'u1', label: 'Alice', mode: 'editing', expiresAt: 40_000 },
		])
	})

	it('heartbeat with viewing clears editing', async () => {
		const kv = makeKv()
		const store = createPresenceStore(kv, { leaseMs: 30_000, now: () => 1_000 })
		await store.join({
			collection: 'posts',
			id: '1',
			peer: { id: 'u1', label: 'Alice', mode: 'editing' },
		})
		await store.heartbeat({
			collection: 'posts',
			id: '1',
			peer: { id: 'u1', label: 'Alice', mode: 'viewing' },
		})
		expect((await store.get({ collection: 'posts', id: '1' }))[0]?.mode).toBe('viewing')
	})
})
