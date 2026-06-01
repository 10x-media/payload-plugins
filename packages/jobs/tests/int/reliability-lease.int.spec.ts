import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { TaskConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { jobs } from '../../src/index'
import { createLeaderController } from '../../src/reliability/leaderController'
import { createLeaseStore } from '../../src/reliability/leaseStore'
import { JOBS_LOCKS_SLUG, LEADER_ROLES } from '../../src/reliability/locksCollection'

// This spec runs three `describeForDb` blocks, each booting a fresh Postgres
// testcontainer in the same Vitest process. Payload's `pushDevSchema` keeps a
// module-level `previousSchema` snapshot and skips the schema push when the
// resolved schema is unchanged, so the 2nd and 3rd Postgres boots would land on
// an empty database (the plugin config is identical across blocks). Forcing the
// push on every boot is the documented escape hatch and only ever creates the
// schema, so it cannot weaken any assertion. Single-block specs (e.g.
// matrix.int.spec.ts run via `test:matrix`, one DB per process) never need it.
// biome-ignore lint/plugin/noProcessEnv: test env boundary (Payload dev-push cache across containers)
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

const noopTask: TaskConfig<'noop'> = {
	slug: 'noop',
	handler: () => ({ output: {} }),
}

describeForDb('jobs reliability registration', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ reliability: {} }),
			db,
			configOverrides: { jobs: { tasks: [noopTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the locks collection', () => {
		expect(booted.payload.collections[JOBS_LOCKS_SLUG]).toBeDefined()
	})

	it('seeds one lock row per leadership role', async () => {
		const { totalDocs } = await booted.payload.count({ collection: JOBS_LOCKS_SLUG })
		expect(totalDocs).toBe(LEADER_ROLES.length)
	})

	it('adds the reliability fields to payload-jobs', () => {
		const fields = booted.payload.collections['payload-jobs']?.config.fields ?? []
		const names = new Set(
			fields.flatMap((f) => ('name' in f && typeof f.name === 'string' ? [f.name] : []))
		)
		expect(names.has('leaseExpiresAt')).toBe(true)
		expect(names.has('recoveryAttempts')).toBe(true)
		expect(names.has('claimedBy')).toBe(true)
	})

	it('read returns the pristine seeded shape for an untouched role', async () => {
		const rec = await createLeaseStore(booted.payload).read('sweeper')
		expect(rec?.role).toBe('sweeper')
		expect(rec?.owner).toBeNull()
		expect(rec?.leaseExpiresAt).toBeNull()
		expect(rec?.fenceToken).toBe(0)
	})
})

describeForDb('lease store semantics', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ reliability: { leaderLeaseTtlMs: 30_000 } }),
			db,
			configOverrides: { jobs: { tasks: [noopTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const store = () => createLeaseStore(booted.payload)

	// Each test starts from a freed lease and a fixed clock.
	const reset = async (clockStart: Date) => {
		clock = installTestClock(clockStart)
		await store().release('scheduler', 'any') // owner mismatch is a no-op; ensures clean slate below
		// Force the row free regardless of prior owner by acquiring then releasing as a known owner.
		const taken = await store().acquireOrSteal('scheduler', 'reset', 1, clock.now())
		if (taken.ok) {
			await store().release('scheduler', 'reset')
		}
	}

	afterAll(() => clock?.reset())

	it('acquires a free lease and bumps the fence token', async () => {
		await reset(new Date('2026-02-01T00:00:00.000Z'))
		const s = store()
		const before = await s.read('scheduler')
		const res = await s.acquireOrSteal('scheduler', 'node-A', 30_000, clock.now())
		expect(res.ok).toBe(true)
		expect(res.fenceToken).toBe((before?.fenceToken ?? 0) + 1)
		const after = await s.read('scheduler')
		expect(after?.owner).toBe('node-A')
	})

	it('rejects a second contender while the lease is valid', async () => {
		await reset(new Date('2026-02-01T01:00:00.000Z'))
		const s = store()
		await s.acquireOrSteal('scheduler', 'node-A', 30_000, clock.now())
		clock.advance(10_000) // still within the 30s lease
		const res = await s.acquireOrSteal('scheduler', 'node-B', 30_000, clock.now())
		expect(res.ok).toBe(false)
		expect((await s.read('scheduler'))?.owner).toBe('node-A')
	})

	it('lets a contender steal only after expiry, bumping the fence token', async () => {
		await reset(new Date('2026-02-01T02:00:00.000Z'))
		const s = store()
		const a = await s.acquireOrSteal('scheduler', 'node-A', 30_000, clock.now())
		clock.advance(30_001) // past expiry
		const b = await s.acquireOrSteal('scheduler', 'node-B', 30_000, clock.now())
		expect(b.ok).toBe(true)
		expect(b.fenceToken).toBe(a.fenceToken + 1)
		expect((await s.read('scheduler'))?.owner).toBe('node-B')
	})

	it('renews only for the current owner and does not bump the fence token', async () => {
		await reset(new Date('2026-02-01T03:00:00.000Z'))
		const s = store()
		const a = await s.acquireOrSteal('scheduler', 'node-A', 30_000, clock.now())
		clock.advance(10_000)
		const renewA = await s.renew('scheduler', 'node-A', 30_000, clock.now())
		expect(renewA.ok).toBe(true)
		expect(renewA.fenceToken).toBe(a.fenceToken) // renew does not bump
		const renewB = await s.renew('scheduler', 'node-B', 30_000, clock.now())
		expect(renewB.ok).toBe(false)
	})

	it('release frees the lease for immediate takeover', async () => {
		await reset(new Date('2026-02-01T04:00:00.000Z'))
		const s = store()
		await s.acquireOrSteal('scheduler', 'node-A', 30_000, clock.now())
		await s.release('scheduler', 'node-A')
		const res = await s.acquireOrSteal('scheduler', 'node-B', 30_000, clock.now())
		expect(res.ok).toBe(true) // no need to wait for expiry
	})

	it('release by a non-owner is a no-op (cannot steal via release)', async () => {
		await reset(new Date('2026-02-01T05:00:00.000Z'))
		const s = store()
		await s.acquireOrSteal('scheduler', 'node-A', 30_000, clock.now())
		await s.release('scheduler', 'node-B') // wrong owner: must not clear the lease
		const after = await s.read('scheduler')
		expect(after?.owner).toBe('node-A')
		expect(after?.leaseExpiresAt).not.toBeNull()
	})
})

describeForDb('lease store concurrency', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ reliability: {} }),
			db,
			configOverrides: { jobs: { tasks: [noopTask] } },
		})
	})

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	it('yields exactly one winner under N concurrent acquires of a free lease', async () => {
		clock = installTestClock(new Date('2026-03-01T00:00:00.000Z'))
		const s = createLeaseStore(booted.payload)
		// Free the sweeper lease first.
		const taken = await s.acquireOrSteal('sweeper', 'reset', 1, clock.now())
		if (taken.ok) {
			await s.release('sweeper', 'reset')
		}

		const now = clock.now()
		const results = await Promise.all(
			Array.from({ length: 20 }, (_, i) => s.acquireOrSteal('sweeper', `node-${i}`, 30_000, now))
		)
		const winners = results.filter((r) => r.ok)
		expect(winners).toHaveLength(1)
		// Run it a few rounds to shake the window (advance past expiry, free, repeat).
		for (let round = 0; round < 5; round++) {
			clock.advance(40_000)
			const again = await Promise.all(
				Array.from({ length: 20 }, (_, i) =>
					s.acquireOrSteal('sweeper', `r${round}-node-${i}`, 30_000, clock.now())
				)
			)
			expect(again.filter((r) => r.ok)).toHaveLength(1)
		}
	})
})

describeForDb('leader election (two contenders, one DB)', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ reliability: { leaderLeaseTtlMs: 30_000 } }),
			db,
			configOverrides: { jobs: { tasks: [noopTask] } },
		})
	})

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	it('elects exactly one leader, fails over after expiry, and sheds a zombie', async () => {
		clock = installTestClock(new Date('2026-04-01T00:00:00.000Z'))
		const store = createLeaseStore(booted.payload)
		// Free the scheduler lease.
		const taken = await store.acquireOrSteal('scheduler', 'reset', 1, clock.now())
		if (taken.ok) {
			await store.release('scheduler', 'reset')
		}

		const a = createLeaderController({ ownerId: 'node-A', role: 'scheduler', store, ttlMs: 30_000 })
		const b = createLeaderController({ ownerId: 'node-B', role: 'scheduler', store, ttlMs: 30_000 })

		// Both tick at the same instant; exactly one wins.
		await a.tick(clock.now())
		await b.tick(clock.now())
		expect([a.isLeader(), b.isLeader()].filter(Boolean)).toHaveLength(1)
		const leader = a.isLeader() ? a : b
		const follower = a.isLeader() ? b : a
		const firstToken = leader.fenceToken()
		expect(firstToken).toBeGreaterThan(0)

		// Follower keeps failing to take over while the leader renews.
		clock.advance(10_000)
		await leader.tick(clock.now())
		await follower.tick(clock.now())
		expect(follower.isLeader()).toBe(false)

		// Leader "pauses" (stops ticking). After expiry the follower steals with a higher fence.
		clock.advance(30_001)
		await follower.tick(clock.now())
		expect(follower.isLeader()).toBe(true)
		expect(follower.fenceToken()).toBe(firstToken + 1)

		// The zombie ex-leader ticks late; its renew fails, so it drops leadership.
		await leader.tick(clock.now())
		expect(leader.isLeader()).toBe(false)
	})
})
