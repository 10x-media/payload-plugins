import { applyJobInterruptions, deferOnInterrupt, evaluateRunGates, jobs } from '@10x-media/jobs'
import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import type { CollectionConfig, TaskConfig } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'

import { contentLock, isContentLocked } from '../../src/index'
import { forgetWindows } from '../../src/state/store'

const LOCKS = 'content-locks'
const START = new Date('2026-01-10T10:00:00.000Z')
const ENDS_AT = '2026-01-10T13:00:00.000Z'

const posts: CollectionConfig = { slug: 'posts', fields: [{ name: 'title', type: 'text' }] }
const notes: CollectionConfig = { slug: 'notes', fields: [{ name: 'body', type: 'text' }] }

const writePost: TaskConfig<'writePost'> = {
	slug: 'writePost',
	retries: 2,
	handler: async ({ req }) => {
		await req.payload.create({ collection: 'posts', data: { title: 'from a job' }, req })
		return { output: {} }
	},
}

const rewritePost = deferOnInterrupt<TaskConfig<'rewritePost'>>({
	slug: 'rewritePost',
	handler: async ({ req }) => {
		await req.payload.create({ collection: 'posts', data: { title: 'from a job' }, req })
		return { output: {} }
	},
})

const rewriteNote = deferOnInterrupt<TaskConfig<'rewriteNote'>>({
	slug: 'rewriteNote',
	handler: async ({ req }) => {
		await req.payload.create({ collection: 'notes', data: { body: 'from a job' }, req })
		return { output: {} }
	},
})

type JobRow = {
	completedAt?: null | string
	deferredBy?: null | string
	error?: { interruptedBy?: string } | null
	hasError?: boolean | null
	waitUntil?: null | string
}

describeForDb('content-lock with @10x-media/jobs', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock

	const payload = () => booted.payload

	const lock = (data: Record<string, unknown> = {}) =>
		payload().create({
			collection: LOCKS,
			data: {
				title: 'Maintenance',
				lockEverything: false,
				collections: ['posts'],
				...data,
			},
			overrideAccess: true,
		})

	const read = async (id: number | string): Promise<JobRow> =>
		(await payload().findByID({
			collection: 'payload-jobs',
			depth: 0,
			id,
			overrideAccess: true,
		})) as unknown as JobRow

	const runOnce = async () => {
		await payload().jobs.run({ allQueues: true, silent: true })
		await applyJobInterruptions(payload())
	}

	beforeAll(async () => {
		clock = installTestClock(START)
		booted = await bootPayload({
			db,
			collections: [posts, notes],
			configOverrides: {
				jobs: { deleteJobOnComplete: false, tasks: [writePost, rewritePost, rewriteNote] },
				plugins: [jobs({})],
			},
			plugin: contentLock({ individualSelection: true }),
		})
	})

	beforeEach(() => {
		clock.set(START)
	})

	afterEach(async () => {
		await payload().delete({
			collection: LOCKS,
			where: { id: { exists: true } },
			overrideAccess: true,
		})
		await payload().delete({ collection: 'payload-jobs', overrideAccess: true, where: {} })
	})

	afterAll(async () => {
		clock.reset()
		await booted.stop()
	})

	it('pauses every queue only while everything is locked', async () => {
		expect((await evaluateRunGates(payload())).global).toBe(false)
		const partial = await lock({ endAtTime: true, endsAt: ENDS_AT })
		expect((await evaluateRunGates(payload())).global).toBe(false)

		await payload().delete({ collection: LOCKS, id: partial.id, overrideAccess: true })
		const everything = await lock({ lockEverything: true, endAtTime: true, endsAt: ENDS_AT })
		const gates = await evaluateRunGates(payload())
		expect(gates.global).toBe(true)
		expect(gates.by).toBe(`content-lock:${everything.id}`)
		expect(gates.until?.toISOString()).toBe(ENDS_AT)
	})

	it('fails a job the lock interrupts, without retries', async () => {
		const window = await lock()
		const job = await payload().jobs.queue({ input: {}, task: 'writePost' })
		await runOnce()
		const row = await read(job.id)
		expect(row.hasError).toBe(true)
		expect(row.error?.interruptedBy).toBe(`content-lock:${window.id}`)
	})

	it('defers an opted-in job to the end, and "End now" releases it', async () => {
		const window = await lock({ endAtTime: true, endsAt: ENDS_AT })
		const job = await payload().jobs.queue({ input: {}, task: 'rewritePost' })
		await runOnce()
		const deferred = await read(job.id)
		expect(deferred.hasError).toBe(false)
		expect(deferred.deferredBy).toBe(`content-lock:${window.id}`)
		expect(new Date(deferred.waitUntil ?? 0).toISOString()).toBe(ENDS_AT)

		await payload().update({
			collection: LOCKS,
			data: { endedAt: START.toISOString() },
			id: window.id,
			overrideAccess: true,
		})
		const released = await read(job.id)
		expect(released.deferredBy ?? null).toBeNull()
		expect(released.waitUntil ?? null).toBeNull()

		await runOnce()
		expect((await read(job.id)).completedAt).toBeTruthy()
	})

	it('releases only the jobs of the window that ended', async () => {
		const postsLock = await lock()
		await lock({ collections: ['notes'] })
		const postJob = await payload().jobs.queue({ input: {}, task: 'rewritePost' })
		const noteJob = await payload().jobs.queue({ input: {}, task: 'rewriteNote' })
		await runOnce()

		await payload().update({
			collection: LOCKS,
			data: { endedAt: START.toISOString() },
			id: postsLock.id,
			overrideAccess: true,
		})
		expect((await read(postJob.id)).deferredBy ?? null).toBeNull()
		expect((await read(noteJob.id)).deferredBy).toMatch(/^content-lock:/)
	})

	it('releases the jobs of a window removed behind the hooks', async () => {
		const window = await lock()
		const job = await payload().jobs.queue({ input: {}, task: 'rewritePost' })
		await runOnce()
		expect((await read(job.id)).deferredBy).toBe(`content-lock:${window.id}`)

		await payload().db.deleteOne({ collection: LOCKS, where: { id: { equals: window.id } } })
		forgetWindows(payload())
		clock.set(new Date(START.getTime() + 2 * 60_000))
		expect(await isContentLocked(payload())).toBe(false)
		expect((await read(job.id)).deferredBy ?? null).toBeNull()
	})

	it('tells server code whether content is locked', async () => {
		expect(await isContentLocked(payload())).toBe(false)
		await lock()
		expect(await isContentLocked(payload())).toBe(true)
		expect(await isContentLocked(payload(), { collection: 'posts' })).toBe(true)
		expect(await isContentLocked(payload(), { collection: 'notes' })).toBe(false)
	})
})
