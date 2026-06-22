import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { TaskConfig } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { resetHandlersInstalled } from '../../src/execution/signals'
import { createWorker, type WorkerTestHandle } from '../../src/execution/worker'
import { jobs } from '../../src/index'
import { createPauseStore } from '../../src/queueControl/pauseStore'
import { createJobLeaseStore } from '../../src/reliability/jobLeaseStore'
import { createLeaseStore } from '../../src/reliability/leaseStore'
import { resolveReliabilityOptions } from '../../src/reliability/options'

// biome-ignore lint/plugin/noProcessEnv: test env boundary (Payload dev-push cache across containers)
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

const resolved = (over = {}) => {
	const r = resolveReliabilityOptions({
		leaderId: 'worker-node',
		leaderLeaseTtlMs: 30_000,
		...over,
	})
	if (!r) {
		throw new Error('reliability options resolved to null')
	}
	return r
}

let ran = 0
const countingTask: TaskConfig<'count'> = {
	slug: 'count',
	handler: () => {
		ran += 1
		return { output: {} }
	},
}

/** Queue a job, then force it into a claimed state owned by `claimedBy`. */
const claimedJob = async (booted: BootedPayload, claimedBy: string) => {
	const job = await booted.payload.jobs.queue({ input: {}, task: 'count' })
	await booted.payload.update({
		collection: 'payload-jobs',
		data: {
			claimedBy,
			fenceToken: 1,
			leaseExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
			processing: true,
		},
		id: job.id,
		overrideAccess: true,
	})
	return job.id
}

const virtualClock = () => {
	let nowMs = 0
	return {
		now: () => nowMs,
		sleep: (ms: number) => {
			nowMs += ms
			return Promise.resolve()
		},
	}
}

describeForDb('job lease store releaseAllClaims', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ reliability: {} }),
			db,
			configOverrides: { jobs: { tasks: [countingTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	afterEach(async () => {
		await booted.payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
	})

	it('requeues only the given owner in-flight jobs and bumps recoveryAttempts', async () => {
		const a1 = await claimedJob(booted, 'node-A')
		const a2 = await claimedJob(booted, 'node-A')
		const b1 = await claimedJob(booted, 'node-B')
		const store = createJobLeaseStore(booted.payload)

		const { released } = await store.releaseAllClaims('node-A')
		expect(released).toBe(2)

		const ra1 = await store.read(a1)
		const ra2 = await store.read(a2)
		const rb1 = await store.read(b1)
		expect(ra1?.processing).toBe(false)
		expect(ra1?.recoveryAttempts).toBe(1)
		expect(ra1?.claimedBy).toBeNull()
		expect(ra2?.processing).toBe(false)
		expect(rb1?.processing).toBe(true) // node-B untouched
		expect(rb1?.claimedBy).toBe('node-B')
	})
})

describeForDb('worker graceful drain', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ reliability: {} }),
			db,
			configOverrides: { jobs: { tasks: [countingTask] } },
		})
	})

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	afterEach(async () => {
		await booted.payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
	})

	it('on a clean drain releases leadership and destroys without requeuing fresh claims (item 26)', async () => {
		clock = installTestClock(new Date('2026-08-01T00:00:00.000Z'))
		const leaseStore = createLeaseStore(booted.payload)
		const jobLeaseStore = createJobLeaseStore(booted.payload)
		// The worker's node id is resolveNodeId('worker-node') === 'worker-node'.
		await leaseStore.acquireOrSteal('scheduler', 'worker-node', 30_000, clock.now())
		await leaseStore.acquireOrSteal('sweeper', 'worker-node', 30_000, clock.now())
		// Two jobs claimed-in-DB with a valid (future) lease, but NOT tracked by this
		// process's in-flight counter: this is exactly the shape of a job that just
		// completed but whose processing:false write has not yet landed.
		const a1 = await claimedJob(booted, 'worker-node')
		const a2 = await claimedJob(booted, 'worker-node')

		const destroy = vi.fn(() => Promise.resolve())
		const vc = virtualClock()
		const worker = createWorker({
			drainTimeoutMs: 1000,
			installSignals: false,
			now: vc.now,
			payload: booted.payload,
			pollIntervalMs: 200,
			reliability: resolved(),
			sleep: vc.sleep,
			destroy,
		})

		const res = await worker.drain()
		// Process-local counter is 0, so this is a clean drain (no timeout).
		expect(res.inFlightAtStart).toBe(0)
		expect(res.timedOut).toBe(false)
		// A clean drain must NOT force-release this node's claims: the two valid-lease
		// rows are left untouched (their recoveryAttempts stay 0, they are not requeued).
		// Genuinely orphaned claims carry expired leases and are recovered by the sweeper.
		expect(res.requeued).toBe(0)
		expect((await jobLeaseStore.read(a1))?.processing).toBe(true)
		expect((await jobLeaseStore.read(a1))?.recoveryAttempts).toBe(0)
		expect((await jobLeaseStore.read(a2))?.processing).toBe(true)
		// Leadership is still released and the instance still destroyed on the clean path.
		expect(destroy).toHaveBeenCalledTimes(1)
		expect((await leaseStore.read('scheduler'))?.owner).toBeNull()
		expect((await leaseStore.read('sweeper'))?.owner).toBeNull()

		// drain is idempotent: a repeat call returns the same result without re-destroying.
		const again = await worker.drain()
		expect(again).toBe(res)
		expect(destroy).toHaveBeenCalledTimes(1)
	})
})

describeForDb('worker run loop', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ reliability: {} }),
			db,
			configOverrides: { jobs: { tasks: [countingTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('start() runs queued jobs on its own timer', async () => {
		ran = 0
		const worker = createWorker({
			installSignals: false,
			payload: booted.payload,
			reliability: resolved(),
			runIntervalMs: 50,
		})
		await booted.payload.jobs.queue({ input: {}, task: 'count' })
		worker.start()
		// Poll until the 50ms run loop has claimed and executed the job. A generous cap
		// keeps this robust under heavy concurrent-suite load (no fixed-window flake).
		const deadline = Date.now() + 5000
		while (ran < 1 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 25))
		}
		;(worker as WorkerTestHandle).stop()
		expect(ran).toBeGreaterThanOrEqual(1)
	})

	it('throws when signal handlers are already installed (item 21)', () => {
		resetHandlersInstalled()
		const first = createWorker({
			installSignals: true,
			payload: booted.payload,
			reliability: resolved(),
		}) as WorkerTestHandle
		try {
			expect(() =>
				createWorker({ installSignals: true, payload: booted.payload, reliability: resolved() })
			).toThrow(/already installed/)
		} finally {
			first.stop()
			resetHandlersInstalled()
		}
	})

	it('a worker created without an explicit pauseStore honors a cluster pause (item 22)', async () => {
		const pauseStore = createPauseStore(booted.payload)
		await pauseStore.resume({ all: true })
		await booted.payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
		ran = 0
		const worker = createWorker({
			installSignals: false,
			payload: booted.payload,
			reliability: resolved(),
			runIntervalMs: 50,
		}) as WorkerTestHandle
		worker.start()
		try {
			// Liveness: with no pause the worker runs a queued job.
			await booted.payload.jobs.queue({ input: {}, task: 'count' })
			const live = Date.now() + 5000
			while (ran < 1 && Date.now() < live) {
				await new Promise((r) => setTimeout(r, 25))
			}
			expect(ran).toBeGreaterThanOrEqual(1)
			const afterLive = ran

			// A global pause must suppress the next job (the default store reads it from KV).
			await pauseStore.pause()
			await booted.payload.jobs.queue({ input: {}, task: 'count' })
			await new Promise((r) => setTimeout(r, 500))
			expect(ran).toBe(afterLive)

			// Resume: the suppressed job now runs, proving the worker was live throughout.
			await pauseStore.resume()
			const resumed = Date.now() + 5000
			while (ran <= afterLive && Date.now() < resumed) {
				await new Promise((r) => setTimeout(r, 25))
			}
			expect(ran).toBeGreaterThan(afterLive)
		} finally {
			worker.stop()
			await pauseStore.resume({ all: true })
			await booted.payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
		}
	})
})
