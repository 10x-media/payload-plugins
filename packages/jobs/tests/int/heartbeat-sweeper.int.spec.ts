import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { TaskConfig } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'

import { jobs } from '../../src/index'
import { withHeartbeat } from '../../src/reliability/heartbeat'
import { createJobLeaseStore } from '../../src/reliability/jobLeaseStore'
import { resolveReliabilityOptions } from '../../src/reliability/options'
import { runSweep } from '../../src/reliability/sweeper'

// biome-ignore lint/plugin/noProcessEnv: test env boundary (Payload dev-push cache across containers)
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

const noopTask: TaskConfig<'noop'> = {
	slug: 'noop',
	handler: () => ({ output: {} }),
}

const resolved = (over = {}) => {
	const r = resolveReliabilityOptions({ jobLeaseTtlMs: 1000, ...over })
	if (!r) {
		throw new Error('reliability options resolved to null')
	}
	return r
}

/** Queue a job, then force it into a claimed (processing: true) state for store tests. */
const claimedJob = async (booted: BootedPayload, data: Record<string, unknown> = {}) => {
	const job = await booted.payload.jobs.queue({ input: {}, task: 'noop' })
	await booted.payload.update({
		collection: 'payload-jobs',
		data: { processing: true, ...data },
		id: job.id,
		overrideAccess: true,
	})
	return job.id
}

describeForDb('job lease store semantics', {}, (db) => {
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

	it('stamps a claimed job and bumps the fence token', async () => {
		clock = installTestClock(new Date('2026-05-01T00:00:00.000Z'))
		const store = createJobLeaseStore(booted.payload)
		const id = await claimedJob(booted)
		const res = await store.stampClaim(id, 'node-A', 1000, clock.now())
		expect(res.ok).toBe(true)
		expect(res.fenceToken).toBeGreaterThan(0)
		const row = await store.read(id)
		expect(row?.claimedBy).toBe('node-A')
		expect(row?.leaseExpiresAt?.toISOString()).toBe('2026-05-01T00:00:01.000Z')
	})

	it('does not stamp a job that is not processing', async () => {
		clock = installTestClock(new Date('2026-05-01T01:00:00.000Z'))
		const store = createJobLeaseStore(booted.payload)
		const job = await booted.payload.jobs.queue({ input: {}, task: 'noop' })
		const res = await store.stampClaim(job.id, 'node-A', 1000, clock.now())
		expect(res.ok).toBe(false)
	})

	it('renews only for the held fence token', async () => {
		clock = installTestClock(new Date('2026-05-01T02:00:00.000Z'))
		const store = createJobLeaseStore(booted.payload)
		const id = await claimedJob(booted)
		const stamp = await store.stampClaim(id, 'node-A', 1000, clock.now())
		clock.advance(500)
		const good = await store.renew(id, stamp.fenceToken, 1000, clock.now())
		expect(good.ok).toBe(true)
		expect((await store.read(id))?.leaseExpiresAt?.toISOString()).toBe('2026-05-01T02:00:01.500Z')
		const stale = await store.renew(id, stamp.fenceToken + 99, 1000, clock.now())
		expect(stale.ok).toBe(false)
	})

	it('requeues a stale orphan and increments recoveryAttempts', async () => {
		clock = installTestClock(new Date('2026-05-01T03:00:00.000Z'))
		const store = createJobLeaseStore(booted.payload)
		const id = await claimedJob(booted)
		await store.stampClaim(id, 'node-A', 1000, clock.now())
		clock.advance(1001) // past expiry
		const res = await store.requeue(id, clock.now(), 1000)
		expect(res.ok).toBe(true)
		const row = await store.read(id)
		expect(row?.processing).toBe(false)
		expect(row?.recoveryAttempts).toBe(1)
		expect(row?.leaseExpiresAt).toBeNull()
	})

	it('does not requeue a job whose lease is still valid', async () => {
		clock = installTestClock(new Date('2026-05-01T04:00:00.000Z'))
		const store = createJobLeaseStore(booted.payload)
		const id = await claimedJob(booted)
		await store.stampClaim(id, 'node-A', 1000, clock.now())
		clock.advance(500) // still within the lease
		const res = await store.requeue(id, clock.now(), 1000)
		expect(res.ok).toBe(false)
		expect((await store.read(id))?.processing).toBe(true)
	})

	it('dead-letters a stale orphan', async () => {
		clock = installTestClock(new Date('2026-05-01T05:00:00.000Z'))
		const store = createJobLeaseStore(booted.payload)
		const id = await claimedJob(booted)
		await store.stampClaim(id, 'node-A', 1000, clock.now())
		clock.advance(1001)
		const res = await store.deadLetter({
			error: { message: 'dead' },
			fallbackMs: 1000,
			jobId: id,
			now: clock.now(),
		})
		expect(res.ok).toBe(true)
		const job = await booted.payload.findByID({ collection: 'payload-jobs', id })
		expect(job.hasError).toBe(true)
		expect((await store.read(id))?.processing).toBe(false)
	})
})

describeForDb('heartbeat wrapper', {}, (db) => {
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

	it('stamps on entry and renews while the handler runs', async () => {
		clock = installTestClock(new Date('2026-06-01T00:00:00.000Z'))
		const store = createJobLeaseStore(booted.payload)
		const id = await claimedJob(booted)

		let release: () => void = () => undefined
		const barrier = new Promise<void>((r) => {
			release = r
		})
		const wrapped = withHeartbeat({
			getStore: () => store,
			handler: () => barrier.then(() => ({ output: {} })),
			options: resolved({ heartbeatIntervalMs: 25, jobLeaseTtlMs: 1000 }),
			ownerId: 'node-A',
		})

		const run = wrapped({ job: { id }, req: { payload: booted.payload } })
		// Let the entry stamp settle, then assert the lease is held.
		await new Promise((r) => setTimeout(r, 10))
		expect((await store.read(id))?.claimedBy).toBe('node-A')

		// Advance the clock and let a real renew tick fire; the stored lease must move.
		clock.advance(500)
		await new Promise((r) => setTimeout(r, 60))
		expect((await store.read(id))?.leaseExpiresAt?.toISOString()).toBe('2026-06-01T00:00:01.500Z')

		release()
		await run
	})

	it('detects a lost lease when the claim is stolen', async () => {
		clock = installTestClock(new Date('2026-06-01T01:00:00.000Z'))
		const store = createJobLeaseStore(booted.payload)
		const id = await claimedJob(booted)

		const lost: Array<number | string> = []
		let release: () => void = () => undefined
		const barrier = new Promise<void>((r) => {
			release = r
		})
		const wrapped = withHeartbeat({
			getStore: () => store,
			handler: () => barrier.then(() => ({ output: {} })),
			onLeaseLost: (jobId) => lost.push(jobId),
			options: resolved({ heartbeatIntervalMs: 25, jobLeaseTtlMs: 1000 }),
			ownerId: 'node-A',
		})

		const run = wrapped({ job: { id }, req: { payload: booted.payload } })
		await new Promise((r) => setTimeout(r, 10))
		// A thief re-stamps the still-processing job, bumping the fence token.
		await store.stampClaim(id, 'thief', 1000, clock.now())
		// The next renew tick (held fence is now stale) must report the loss.
		await new Promise((r) => setTimeout(r, 60))
		expect(lost).toContain(id)

		release()
		await run
	})
})

describeForDb('heartbeat registration seam', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	let seenLease: string | null | undefined

	const probeTask: TaskConfig<'probe'> = {
		slug: 'probe',
		handler: async ({ job, req }) => {
			const row = await req.payload.findByID({ collection: 'payload-jobs', id: job.id })
			seenLease = (row as { leaseExpiresAt?: string | null }).leaseExpiresAt ?? null
			return { output: {} }
		},
	}

	beforeAll(async () => {
		// jobLeaseTtlMs: 1000 so the registered heartbeat stamps a 1s lease (the
		// resolved default is 300000, which would land at 02:05:00 not 02:00:01).
		booted = await bootPayload({
			plugin: jobs({ reliability: { jobLeaseTtlMs: 1000 } }),
			db,
			configOverrides: { jobs: { tasks: [probeTask] } },
		})
	})

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	it('wraps registered handlers so a real run stamps the lease', async () => {
		clock = installTestClock(new Date('2026-06-01T02:00:00.000Z'))
		await booted.payload.jobs.queue({ input: {}, task: 'probe' })
		await booted.payload.jobs.run({ allQueues: true })
		// Normalize formatting across adapters (string vs Date serialization).
		expect(seenLease).toBeTruthy()
		expect(new Date(seenLease as string).toISOString()).toBe('2026-06-01T02:00:01.000Z')
	})
})

describeForDb('sweeper', {}, (db) => {
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

	// The sweeper's payload.find is global, so leftover orphans from one test would be
	// reclaimed by the next; clear the jobs between tests to keep each count exact.
	afterEach(async () => {
		await booted.payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
	})

	/** Seed a stuck job: claimed, with the given fields, then advance the clock past its lease. */
	const stuck = async (data: Record<string, unknown>) => {
		const id = await claimedJob(booted, data)
		return id
	}

	it('requeues a stale orphan below the cap', async () => {
		clock = installTestClock(new Date('2026-07-01T00:00:00.000Z'))
		const id = await stuck({
			claimedBy: 'dead',
			fenceToken: 1,
			leaseExpiresAt: new Date('2026-06-30T23:59:00.000Z'),
			recoveryAttempts: 0,
		})
		const res = await runSweep({ now: clock.now(), options: resolved(), payload: booted.payload })
		expect(res.requeued).toBe(1)
		const store = createJobLeaseStore(booted.payload)
		const row = await store.read(id)
		expect(row?.processing).toBe(false)
		expect(row?.recoveryAttempts).toBe(1)
	})

	it('dead-letters a stale orphan at the cap', async () => {
		clock = installTestClock(new Date('2026-07-01T01:00:00.000Z'))
		const id = await stuck({
			claimedBy: 'dead',
			fenceToken: 1,
			leaseExpiresAt: new Date('2026-07-01T00:59:00.000Z'),
			recoveryAttempts: 3,
		})
		const res = await runSweep({ now: clock.now(), options: resolved(), payload: booted.payload })
		expect(res.deadLettered).toBe(1)
		const job = await booted.payload.findByID({ collection: 'payload-jobs', id })
		expect(job.hasError).toBe(true)
	})

	it('does not touch a healthy job whose lease is in the future', async () => {
		clock = installTestClock(new Date('2026-07-01T02:00:00.000Z'))
		await stuck({
			claimedBy: 'alive',
			fenceToken: 1,
			leaseExpiresAt: new Date('2026-07-01T02:05:00.000Z'),
			recoveryAttempts: 0,
		})
		const res = await runSweep({ now: clock.now(), options: resolved(), payload: booted.payload })
		expect(res.requeued).toBe(0)
		expect(res.deadLettered).toBe(0)
	})

	it('recovers a null-lease job via the updatedAt fallback', async () => {
		clock = installTestClock(new Date('2026-07-01T03:00:00.000Z'))
		const id = await booted.payload.jobs.queue({ input: {}, task: 'noop' }).then((j) => j.id)
		// Claimed, but no lease ever stamped; make updatedAt old relative to now.
		await booted.payload.update({
			collection: 'payload-jobs',
			data: { claimedBy: null, leaseExpiresAt: null, processing: true },
			id,
			overrideAccess: true,
		})
		// fallbackMs default is jobLeaseTtlMs; advance the clock well past it.
		clock.advance(400_000)
		const res = await runSweep({ now: clock.now(), options: resolved(), payload: booted.payload })
		expect(res.requeued).toBe(1)
	})

	it('is a no-op when not the leader', async () => {
		clock = installTestClock(new Date('2026-07-01T04:00:00.000Z'))
		await stuck({
			claimedBy: 'dead',
			fenceToken: 1,
			leaseExpiresAt: new Date('2026-07-01T03:59:00.000Z'),
			recoveryAttempts: 0,
		})
		const res = await runSweep({
			isLeader: false,
			now: clock.now(),
			options: resolved(),
			payload: booted.payload,
		})
		expect(res.scanned).toBe(0)
	})

	it('two concurrent sweeps reclaim each orphan exactly once', async () => {
		clock = installTestClock(new Date('2026-07-01T05:00:00.000Z'))
		await stuck({
			claimedBy: 'dead',
			fenceToken: 1,
			leaseExpiresAt: new Date('2026-07-01T04:59:00.000Z'),
			recoveryAttempts: 0,
		})
		const [a, b] = await Promise.all([
			runSweep({ now: clock.now(), options: resolved(), payload: booted.payload }),
			runSweep({ now: clock.now(), options: resolved(), payload: booted.payload }),
		])
		expect(a.requeued + b.requeued).toBe(1)
	})
})

describeForDb('concurrency control enforcement', {}, (db) => {
	it('refuses to boot when required but not enabled', async () => {
		await expect(
			bootPayload({
				plugin: jobs({ reliability: { requireConcurrencyControl: true } }),
				db,
				configOverrides: { jobs: { tasks: [noopTask] } },
			})
		).rejects.toThrow(/enableConcurrencyControl/)
	})

	it('boots when required and enabled', async () => {
		const booted = await bootPayload({
			plugin: jobs({ reliability: { requireConcurrencyControl: true } }),
			db,
			configOverrides: { jobs: { enableConcurrencyControl: true, tasks: [noopTask] } },
		})
		expect(booted.payload.collections['payload-jobs']).toBeDefined()
		await booted.stop()
	})
})
