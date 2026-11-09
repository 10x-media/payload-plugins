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
import { native } from '../../src/native/nativeAdapter'
import { settleRetiredRuntimes } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const MINUTE = 60_000
const QUEUE = 'analytics'

const TASKS = [
	{ slug: TASK_SLUGS.maintain },
	{ slug: TASK_SLUGS.sync },
	{ slug: TASK_SLUGS.warm },
] as const

/**
 * Payload's own `payload.jobs.handleSchedules`: its `defaultBeforeSchedule` refuses while a
 * scheduled run is queued or processing unerrored, and a killed run's lapsed lease changes nothing.
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
	)(`keeps a killed $slug run as the one open run, for the runner to pick up again, on ${db}`, async ({
		slug,
	}) => {
		const { payload } = booted
		const [queued] = await openRuns(slug)
		expect(queued).toBeDefined()
		// A run that was claimed and then killed: its lease lapsed an hour ago.
		await payload.db.updateJobs({
			id: queued?.id ?? '',
			data: {
				processingUntil: new Date(NOW.getTime() - 60 * MINUTE).toISOString(),
				processingToken: 'killed-run',
			},
			returning: false,
		})
		await payload.jobs.handleSchedules({ queue: QUEUE })
		await payload.jobs.handleSchedules({ queue: QUEUE })
		const open = await openRuns(slug)
		expect(open).toHaveLength(1)
		expect(open[0]?.id).toEqual(queued?.id)
	})
})
