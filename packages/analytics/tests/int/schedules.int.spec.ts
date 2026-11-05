import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { TASK_SLUGS } from '../../src/core/jobs'
import { analytics } from '../../src/index'
import { stateLease, TASK_LEASE_MS } from '../../src/maintenance/lease'
import { TASK_DEAD_AFTER_MS } from '../../src/maintenance/taskSchedule'
import { native } from '../../src/native/nativeAdapter'
import { MAINTAIN_DEAD_AFTER_MS } from '../../src/native/tasks/maintainTask'
import { settleRetiredRuntimes } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000
const QUEUE = 'analytics'

/** Each task, how long its run may sit processing, and whether a live run holds a lease for it. */
const TASKS = [
	{ slug: TASK_SLUGS.maintain, deadAfterMs: MAINTAIN_DEAD_AFTER_MS, leased: false },
	{ slug: TASK_SLUGS.sync, deadAfterMs: TASK_DEAD_AFTER_MS, leased: true },
	{ slug: TASK_SLUGS.warm, deadAfterMs: TASK_DEAD_AFTER_MS, leased: true },
] as const

/**
 * Payload's own `payload.jobs.handleSchedules`, not a copy: the plugin's guard ends in Payload's
 * `defaultBeforeSchedule`, which refuses while a scheduled run is queued or processing unerrored.
 */
describeForDb("analytics tasks under Payload's schedule handling", {}, (db) => {
	let clock: TestClock
	let booted: BootedPayload

	beforeAll(async () => {
		clock = installTestClock(NOW)
		booted = await bootPayload({
			db,
			disableOnInit: true,
			plugin: analytics({
				adapters: [native(), memoryAdapter()],
				capture: { gate: 'off' },
				sync: true,
				cache: { warm: true },
				jobs: { queue: QUEUE },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await settleRetiredRuntimes(booted.payload)
		await booted.stop()
	})

	const openRuns = async (task: string) =>
		(
			await booted.payload.find({
				collection: 'payload-jobs',
				where: {
					and: [
						{ taskSlug: { equals: task } },
						{ completedAt: { exists: false } },
						{ hasError: { not_equals: true } },
					],
				},
				depth: 0,
			})
		).docs

	it(`queues one run of each task however often schedules are handled on ${db}`, async () => {
		const first = await booted.payload.jobs.handleSchedules({ queue: QUEUE })
		const second = await booted.payload.jobs.handleSchedules({ queue: QUEUE })
		const slugs = TASKS.map((task) => task.slug).sort()
		expect(first.queued.map((each) => each.taskConfig?.slug).sort()).toEqual(slugs)
		expect(first.errored).toEqual([])
		expect(second.queued).toEqual([])
		expect(second.skipped.map((each) => each.taskConfig?.slug).sort()).toEqual(slugs)
		for (const task of TASKS) {
			expect(await openRuns(task.slug), task.slug).toHaveLength(1)
		}
	})

	it.each(
		TASKS
	)(`lets the next $slug through once its run has been processing too long on ${db}`, async ({
		slug,
		deadAfterMs,
		leased,
	}) => {
		const { payload } = booted
		const [queued] = await openRuns(slug)
		expect(queued).toBeDefined()
		const markProcessing = (minutesAgo: number) =>
			payload.db.updateJobs({
				id: queued?.id ?? '',
				data: {
					processing: true,
					updatedAt: new Date(NOW.getTime() - minutesAgo * MINUTE).toISOString(),
				},
				returning: false,
			})
		const stillProcessing = [expect.objectContaining({ id: queued?.id, processing: true })]
		// Within what a live run can take: left alone, and nothing new is queued.
		await markProcessing(deadAfterMs / MINUTE - 1)
		await payload.jobs.handleSchedules({ queue: QUEUE })
		expect(await openRuns(slug)).toEqual(stillProcessing)
		await markProcessing(deadAfterMs / MINUTE + 1)
		if (leased) {
			// A run holding the task's lease is alive, however old its job looks.
			const lease = stateLease(payload, slug, TASK_LEASE_MS)
			expect(await lease?.claim()).toBe(true)
			await payload.jobs.handleSchedules({ queue: QUEUE })
			expect(await openRuns(slug)).toEqual(stillProcessing)
			await lease?.release()
		}
		// Past it with nobody holding it: failed, and the next run is queued, once.
		await payload.jobs.handleSchedules({ queue: QUEUE })
		await payload.jobs.handleSchedules({ queue: QUEUE })
		const stuck = await payload.findByID({
			collection: 'payload-jobs',
			id: queued?.id ?? '',
			depth: 0,
		})
		expect(stuck).toMatchObject({ processing: false, hasError: true })
		const next = await openRuns(slug)
		expect(next).toHaveLength(1)
		expect(next[0]?.id).not.toEqual(queued?.id)
		expect(next[0]?.processing).toBe(false)
	})
})
