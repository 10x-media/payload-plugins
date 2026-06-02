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

// biome-ignore lint/plugin/noProcessEnv: test env boundary (Payload dev-push cache across containers)
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

const noop: TaskConfig<'noop'> = { slug: 'noop', handler: () => ({ output: {} }) }

describeForDb('multi-instance leader election (two real instances, one DB)', {}, (db) => {
	let a: BootedPayload
	let b: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		a = await bootPayload({
			plugin: jobs({ reliability: { leaderLeaseTtlMs: 30_000 } }),
			db,
			configOverrides: { jobs: { tasks: [noop] } },
		})
		b = await bootPayload({
			plugin: jobs({ reliability: { leaderLeaseTtlMs: 30_000 } }),
			db,
			attachTo: a,
			configOverrides: { jobs: { tasks: [noop] } },
		})
	})

	afterAll(async () => {
		clock?.reset()
		await b.stop() // attached: destroys only this Payload
		await a.stop() // owns and stops the DB
	})

	it('elects one leader across two instances, fails over after expiry, and fences a zombie', async () => {
		clock = installTestClock(new Date('2026-09-01T00:00:00.000Z'))
		const storeA = createLeaseStore(a.payload)
		const storeB = createLeaseStore(b.payload)
		// Ensure the scheduler lease starts free.
		const taken = await storeA.acquireOrSteal('scheduler', 'reset', 1, clock.now())
		if (taken.ok) {
			await storeA.release('scheduler', 'reset')
		}

		const ctrlA = createLeaderController({
			ownerId: 'node-A',
			role: 'scheduler',
			store: storeA,
			ttlMs: 30_000,
		})
		const ctrlB = createLeaderController({
			ownerId: 'node-B',
			role: 'scheduler',
			store: storeB,
			ttlMs: 30_000,
		})

		await ctrlA.tick(clock.now())
		await ctrlB.tick(clock.now())
		expect([ctrlA.isLeader(), ctrlB.isLeader()].filter(Boolean)).toHaveLength(1)
		const leader = ctrlA.isLeader() ? ctrlA : ctrlB
		const follower = ctrlA.isLeader() ? ctrlB : ctrlA
		const firstToken = leader.fenceToken()
		expect(firstToken).toBeGreaterThan(0)

		clock.advance(10_000)
		await leader.tick(clock.now())
		await follower.tick(clock.now())
		expect(follower.isLeader()).toBe(false)

		clock.advance(30_001)
		await follower.tick(clock.now())
		expect(follower.isLeader()).toBe(true)
		expect(follower.fenceToken()).toBe(firstToken + 1)

		await leader.tick(clock.now())
		expect(leader.isLeader()).toBe(false)
	})
})
