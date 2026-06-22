import { describe, expect, it } from 'vitest'

import { createLeaderController } from './leaderController'
import type { LeaseRecord, LeaseResult, LeaseStore } from './leaseStore'
import type { LeaderRole } from './locksCollection'

/** A minimal single-role in-memory lease store for unit testing the controller. */
const fakeStore = (): LeaseStore => {
	let rec: LeaseRecord = { fenceToken: 0, leaseExpiresAt: null, owner: null, role: 'scheduler' }
	const stale = (now: Date): boolean => {
		return rec.leaseExpiresAt === null || rec.leaseExpiresAt.getTime() < now.getTime()
	}
	return {
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (role, owner, ttlMs, now)
		acquireOrSteal: async (_role, owner, ttlMs, now): Promise<LeaseResult> => {
			if (rec.owner === null || stale(now)) {
				rec = {
					...rec,
					fenceToken: rec.fenceToken + 1,
					leaseExpiresAt: new Date(now.getTime() + ttlMs),
					owner,
				}
				return { fenceToken: rec.fenceToken, ok: true }
			}
			return { fenceToken: 0, ok: false }
		},
		read: async (): Promise<LeaseRecord | null> => rec,
		release: async (_role, owner): Promise<{ ok: boolean }> => {
			if (rec.owner === owner) {
				rec = { ...rec, leaseExpiresAt: null, owner: null }
				return { ok: true }
			}
			return { ok: false }
		},
		// biome-ignore lint/complexity/useMaxParams: lease primitive signature (role, owner, ttlMs, now)
		renew: async (_role, owner, ttlMs, now): Promise<LeaseResult> => {
			if (rec.owner === owner && !stale(now)) {
				rec = { ...rec, leaseExpiresAt: new Date(now.getTime() + ttlMs) }
				return { fenceToken: rec.fenceToken, ok: true }
			}
			return { fenceToken: 0, ok: false }
		},
	}
}

const role: LeaderRole = 'scheduler'

describe('createLeaderController', () => {
	it('acquires leadership on the first tick and exposes the fence token', async () => {
		const c = createLeaderController({ ownerId: 'node-A', role, store: fakeStore(), ttlMs: 30_000 })
		expect(c.isLeader()).toBe(false)
		await c.tick(new Date('2026-01-01T00:00:00.000Z'))
		expect(c.isLeader()).toBe(true)
		expect(c.fenceToken()).toBe(1)
	})

	it('renews while leading without changing the fence token', async () => {
		const c = createLeaderController({ ownerId: 'node-A', role, store: fakeStore(), ttlMs: 30_000 })
		await c.tick(new Date('2026-01-01T00:00:00.000Z'))
		await c.tick(new Date('2026-01-01T00:00:10.000Z'))
		expect(c.isLeader()).toBe(true)
		expect(c.fenceToken()).toBe(1)
	})

	it('drops leadership when a renew fails (lease stolen while paused)', async () => {
		const store = fakeStore()
		const a = createLeaderController({ ownerId: 'node-A', role, store, ttlMs: 30_000 })
		await a.tick(new Date('2026-01-01T00:00:00.000Z'))
		expect(a.isLeader()).toBe(true)
		// Another node steals after expiry.
		await store.acquireOrSteal(role, 'node-B', 30_000, new Date('2026-01-01T00:00:31.000Z'))
		// A ticks late; its renew fails, so it must drop leadership.
		await a.tick(new Date('2026-01-01T00:00:32.000Z'))
		expect(a.isLeader()).toBe(false)
	})

	it('release relinquishes leadership', async () => {
		const c = createLeaderController({ ownerId: 'node-A', role, store: fakeStore(), ttlMs: 30_000 })
		await c.tick(new Date('2026-01-01T00:00:00.000Z'))
		await c.release()
		expect(c.isLeader()).toBe(false)
	})

	it('clears leading state when release returns ok:false (node no longer owns the lease)', async () => {
		// acquireOrSteal succeeds but release reports no matching row: the lease was stolen,
		// expired, or already released, so this node is not the owner and must stop leading.
		const store: LeaseStore = {
			acquireOrSteal: async () => ({ fenceToken: 1, ok: true }),
			read: async () => null,
			release: async () => ({ ok: false }),
			renew: async () => ({ fenceToken: 1, ok: true }),
		}
		const c = createLeaderController({ ownerId: 'node-A', role, store, ttlMs: 30_000 })
		await c.tick(new Date('2026-01-01T00:00:00.000Z'))
		expect(c.isLeader()).toBe(true)

		await c.release()
		expect(c.isLeader()).toBe(false)
		expect(c.fenceToken()).toBe(0)
	})

	it('re-acquires with a bumped fence token after release', async () => {
		const c = createLeaderController({ ownerId: 'node-A', role, store: fakeStore(), ttlMs: 30_000 })
		await c.tick(new Date('2026-01-01T00:00:00.000Z'))
		expect(c.fenceToken()).toBe(1)
		await c.release()
		expect(c.isLeader()).toBe(false)
		await c.tick(new Date('2026-01-01T00:00:10.000Z'))
		expect(c.isLeader()).toBe(true)
		expect(c.fenceToken()).toBeGreaterThan(1)
	})

	it('falls through to acquireOrSteal with a fence bump when renew fails on an expired lease (item 19)', async () => {
		// Node A holds the lease but its TTL elapses without a renew. Its next tick should
		// go through acquireOrSteal (fence bump) rather than just dropping leadership.
		const store = fakeStore()
		const a = createLeaderController({ ownerId: 'node-A', role, store, ttlMs: 5_000 })
		const t0 = new Date('2026-01-01T00:00:00.000Z')
		await a.tick(t0) // acquires; fenceToken = 1, leaseExpiresAt = t0 + 5s
		expect(a.isLeader()).toBe(true)
		expect(a.fenceToken()).toBe(1)

		// Tick after expiry: renew should return ok:false (lease expired, with item 19's fix),
		// and the controller should fall through to acquireOrSteal, bumping the fence.
		const t1 = new Date('2026-01-01T00:00:06.000Z') // t0 + 6s > ttl (5s)
		await a.tick(t1)
		// After the fix: acquireOrSteal was called, fence token bumped to 2.
		expect(a.isLeader()).toBe(true)
		expect(a.fenceToken()).toBeGreaterThan(1)
	})

	it('a losing acquire never flips leadership and never exposes the sentinel token', async () => {
		const store = fakeStore()
		const a = createLeaderController({ ownerId: 'node-A', role, store, ttlMs: 30_000 })
		const b = createLeaderController({ ownerId: 'node-B', role, store, ttlMs: 30_000 })
		await a.tick(new Date('2026-01-01T00:00:00.000Z'))
		expect(a.isLeader()).toBe(true)
		// B contends while A's lease is still valid: it must not win, and must not surface the sentinel 0.
		await b.tick(new Date('2026-01-01T00:00:05.000Z'))
		expect(b.isLeader()).toBe(false)
		expect(b.fenceToken()).toBe(0)
	})
})
