import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest, TaskConfig } from 'payload'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'

import { jobs } from '../../src/index'
import { runControlEndpoint, statusEndpoint, sweepEndpoint } from '../../src/queueControl/endpoints'
import { createPauseStore } from '../../src/queueControl/pauseStore'
import { getQueueHealth } from '../../src/queueControl/queueHealth'

// biome-ignore lint/plugin/noProcessEnv: test env boundary (Payload dev-push cache across containers)
process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = 'true'

const noopTask: TaskConfig<'noop'> = {
	slug: 'noop',
	handler: () => ({ output: {} }),
}

const deps = (_booted: BootedPayload, over = {}) => ({
	access: () => true,
	queues: ['default', 'emails'],
	reliability: null,
	...over,
})

/** A minimal PayloadRequest for invoking an endpoint handler directly. */
const fakeReq = (
	booted: BootedPayload,
	over: { query?: Record<string, string>; user?: unknown; authorization?: string } = {}
): PayloadRequest =>
	({
		headers: new Headers(over.authorization ? { authorization: over.authorization } : {}),
		payload: booted.payload,
		query: over.query ?? {},
		user: over.user ?? null,
	}) as unknown as PayloadRequest

describeForDb('pause store', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({}),
			db,
			configOverrides: { jobs: { tasks: [noopTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('pauses and resumes globally and per-queue, durably', async () => {
		const store = createPauseStore(booted.payload)
		expect(await store.isPaused('emails')).toBe(false)
		await store.pause('emails')
		expect(await store.isPaused('emails')).toBe(true)
		expect(await store.isPaused('default')).toBe(false)
		expect((await store.getState()).queues).toContain('emails')
		await store.resume('emails')
		expect(await store.isPaused('emails')).toBe(false)
		await store.pause()
		expect(await store.isPaused('anything')).toBe(true)
		await store.resume()
		expect(await store.isPaused('anything')).toBe(false)
	})
})

describeForDb('queue health', {}, (db) => {
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

	afterEach(async () => {
		await booted.payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
	})

	it('counts pending and processing and reports a null lastScheduledRun', async () => {
		await booted.payload.jobs.queue({ input: {}, queue: 'default', task: 'noop' })
		const proc = await booted.payload.jobs.queue({ input: {}, queue: 'emails', task: 'noop' })
		await booted.payload.update({
			collection: 'payload-jobs',
			data: { processing: true },
			id: proc.id,
			overrideAccess: true,
		})

		const report = await getQueueHealth(booted.payload, {
			includeRecovered: true,
			queues: ['default', 'emails'],
		})
		expect(report.totals.pending).toBe(1)
		expect(report.totals.processing).toBe(1)
		expect(report.oldestPendingAgeMs).not.toBeNull()
		const emails = report.queues.find((q) => q.queue === 'emails')
		expect(emails?.processing).toBe(1)
		expect(emails?.lastScheduledRun).toBeNull() // no schedules: stats global absent, handled
	})
})

describeForDb('queue-control endpoints', {}, (db) => {
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

	afterEach(async () => {
		await booted.payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
		await createPauseStore(booted.payload).resume() // clear global
		await createPauseStore(booted.payload).resume('emails')
	})

	it('status endpoint returns a health report', async () => {
		const res = await statusEndpoint(deps(booted)).handler(fakeReq(booted))
		expect(res.status).toBe(200)
		const body = (await res.json()) as { totals: { pending: number } }
		expect(typeof body.totals.pending).toBe('number')
	})

	it('denies access with 401 when the checker rejects', async () => {
		const res = await statusEndpoint(deps(booted, { access: () => false })).handler(fakeReq(booted))
		expect(res.status).toBe(401)
	})

	it('run endpoint honors a paused queue', async () => {
		await createPauseStore(booted.payload).pause('emails')
		await booted.payload.jobs.queue({ input: {}, queue: 'emails', task: 'noop' })
		await booted.payload.jobs.queue({ input: {}, queue: 'default', task: 'noop' })

		const res = await runControlEndpoint(deps(booted)).handler(
			fakeReq(booted, { query: { allQueues: 'true' } })
		)
		expect(res.status).toBe(200)
		// emails is paused, so its job remains; default ran and was deleted (deleteJobOnComplete).
		const emailsLeft = await booted.payload.count({
			collection: 'payload-jobs',
			where: { queue: { equals: 'emails' } },
		})
		const defaultLeft = await booted.payload.count({
			collection: 'payload-jobs',
			where: { queue: { equals: 'default' } },
		})
		expect(emailsLeft.totalDocs).toBe(1)
		expect(defaultLeft.totalDocs).toBe(0)
	})

	it('sweep endpoint runs the sweeper when reliability is enabled', async () => {
		const resolved = booted.payload.config.jobs
		expect(resolved).toBeDefined()
		const res = await sweepEndpoint(
			deps(booted, {
				reliability: {
					heartbeatIntervalMs: 100_000,
					jobLeaseTtlMs: 300_000,
					leaderId: null,
					leaderLeaseTtlMs: 30_000,
					maxRecoveries: 3,
					requireConcurrencyControl: false,
					serverlessMaxDurationMs: null,
					sweepIntervalMs: 60_000,
				},
			})
		).handler(fakeReq(booted))
		expect(res.status).toBe(200)
		const body = (await res.json()) as { scanned: number }
		expect(typeof body.scanned).toBe('number')
	})

	it('sweep endpoint returns 400 when reliability is disabled', async () => {
		const res = await sweepEndpoint(deps(booted)).handler(fakeReq(booted))
		expect(res.status).toBe(400)
	})

	it('run endpoint runs nothing while globally paused', async () => {
		await createPauseStore(booted.payload).pause()
		await booted.payload.jobs.queue({ input: {}, queue: 'default', task: 'noop' })
		await booted.payload.jobs.queue({ input: {}, queue: 'emails', task: 'noop' })

		const res = await runControlEndpoint(deps(booted)).handler(
			fakeReq(booted, { query: { allQueues: 'true' } })
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as { ran: number }
		expect(body.ran).toBe(0)
		const total = await booted.payload.count({ collection: 'payload-jobs' })
		expect(total.totalDocs).toBe(2) // both jobs remain; nothing ran
	})
})

describeForDb('queue-control registration', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: jobs({ queueControl: {} }),
			db,
			configOverrides: { jobs: { tasks: [noopTask] } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the endpoints and hardens jobs.access.run', () => {
		const collection = booted.payload.collections['payload-jobs']?.config
		const endpoints = Array.isArray(collection?.endpoints) ? collection.endpoints : []
		const paths = endpoints.map((e) => e.path)
		expect(paths).toContain('/queue-status')
		expect(paths).toContain('/queue-run')
		expect(paths).toContain('/queue-sweep')
		expect(typeof booted.payload.config.jobs?.access?.run).toBe('function')
	})
})
