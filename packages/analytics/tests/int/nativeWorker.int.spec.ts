import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { trackServerEvent } from '../../src/native/ingest/serverTrack'
import { native } from '../../src/native/nativeAdapter'
import { MAINTAIN_DEAD_AFTER_MS, MAINTAIN_TASK_SLUG } from '../../src/native/tasks/maintainTask'
import { addCalendarDays, type CalendarDay, calendarDayStart } from '../../src/timeframe/calendar'
import { nativeOf, pageviewHit } from './nativeHelpers'

const MINUTE = 60_000
/** Noon UTC: the three days before today are closed, the last of them not sealed yet. */
const NOW = new Date('2026-10-07T12:00:00.000Z')
const TODAY = 20261007
const DAYS: readonly CalendarDay[] = [20261004, 20261005, 20261006]

const RUNTIME_KEY = Symbol.for('@10x-media/analytics/runtime')

const plugin = () =>
	analytics({
		adapters: [native()],
		capture: { gate: 'off' },
		jobs: { queue: 'analytics' },
	})

const wholeDays = (from: CalendarDay, to: CalendarDay) => ({
	start: calendarDayStart(from, 'UTC'),
	end: new Date(calendarDayStart(addCalendarDays(to, 1), 'UTC').getTime() - 1),
})

describeForDb('native maintenance on a jobs worker', {}, (db) => {
	let web: BootedPayload
	let worker: BootedPayload
	let clock: TestClock

	beforeAll(async () => {
		clock = installTestClock(NOW)
		web = await bootPayload({ db, plugin: plugin() })
		worker = await bootPayload({ db, plugin: plugin(), attachTo: web, disableOnInit: true })
		await nativeOf(web.payload).store.append(
			DAYS.flatMap((day, index) =>
				Array.from({ length: index + 1 }, (_, visit) =>
					pageviewHit({
						ts: new Date(calendarDayStart(day, 'UTC').getTime() + (60 + visit) * MINUTE),
						v: `web-${day}-${visit}`.padEnd(16, '0'),
					})
				)
			)
		)
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await worker?.stop()
		await web?.stop()
	})

	it(`schedules analytics-maintain every 15 minutes on the queue jobs names on ${db}`, () => {
		const task = worker.payload.config.jobs.tasks?.find((each) => each.slug === MAINTAIN_TASK_SLUG)
		expect(task?.schedule).toMatchObject([{ cron: '*/15 * * * *', queue: 'analytics' }])
		expect(task?.retries).toBe(0)
		expect(Reflect.get(worker.payload, RUNTIME_KEY)).toBeUndefined()
	})

	it(`counts the closed days when a worker booted without onInit runs the job on ${db}`, async () => {
		const job = await worker.payload.jobs.queue({
			task: MAINTAIN_TASK_SLUG,
			input: {},
			queue: 'analytics',
		})
		const run = await worker.payload.jobs.run({ queue: 'analytics' })
		expect(run.jobStatus?.[String(job.id)]?.status).toBe('success')
		const markers = await nativeOf(web.payload).state.markers('', DAYS[0] ?? 0, TODAY)
		expect(markers.map((marker) => [marker.day, marker.status])).toEqual([
			[20261004, 'final'],
			[20261005, 'final'],
			[20261006, 'provisional'],
		])
		expect(await nativeOf(web.payload).state.lastBeat(MAINTAIN_TASK_SLUG)).toEqual(NOW)
	})

	it(`serves the days the worker counted from the web instance on ${db}`, async () => {
		const read = await nativeOf(web.payload).engine.read({
			metrics: ['pageviews', 'visitors'],
			dateRange: wholeDays(20261004, 20261006),
			granularity: 'day',
		})
		expect(read.rows.map((row) => row.metrics.pageviews)).toEqual([1, 2, 3])
		expect(read.meta.partial).toBeUndefined()
	})

	const openRuns = async (): Promise<Array<{ id: string | number; processing?: boolean }>> => {
		const { docs } = await worker.payload.find({
			collection: 'payload-jobs',
			where: {
				and: [
					{ taskSlug: { equals: MAINTAIN_TASK_SLUG } },
					{ completedAt: { exists: false } },
					{ hasError: { not_equals: true } },
				],
			},
			depth: 0,
		})
		return docs
	}

	it(`queues one scheduled run however often schedules are handled on ${db}`, async () => {
		await worker.payload.jobs.handleSchedules({ queue: 'analytics' })
		await worker.payload.jobs.handleSchedules({ queue: 'analytics' })
		expect(await openRuns()).toHaveLength(1)
	})

	it(`schedules again once a run killed mid-way has been processing too long on ${db}`, async () => {
		const [queued] = await openRuns()
		expect(queued).toBeDefined()
		const markProcessing = (minutesAgo: number) =>
			worker.payload.db.updateJobs({
				id: queued?.id ?? '',
				data: {
					processing: true,
					updatedAt: new Date(NOW.getTime() - minutesAgo * MINUTE).toISOString(),
				},
				returning: false,
			})
		// Still within what a live run can take: left alone, and nothing new is queued.
		await markProcessing(MAINTAIN_DEAD_AFTER_MS / MINUTE - 1)
		await worker.payload.jobs.handleSchedules({ queue: 'analytics' })
		expect(await openRuns()).toEqual([
			expect.objectContaining({ id: queued?.id, processing: true }),
		])
		// Past it: the run was killed, so it is failed and the next one is queued, once.
		await markProcessing(MAINTAIN_DEAD_AFTER_MS / MINUTE + 1)
		await worker.payload.jobs.handleSchedules({ queue: 'analytics' })
		await worker.payload.jobs.handleSchedules({ queue: 'analytics' })
		const stuck = await worker.payload.findByID({
			collection: 'payload-jobs',
			id: queued?.id ?? '',
			depth: 0,
		})
		expect(stuck).toMatchObject({ processing: false, hasError: true })
		const next = await openRuns()
		expect(next).toHaveLength(1)
		expect(next[0]?.id).not.toEqual(queued?.id)
		expect(next[0]?.processing).toBe(false)
	})

	it(`records a server event on the worker that the web instance reads on ${db}`, async () => {
		await trackServerEvent(worker.payload, {
			type: 'pageview',
			path: '/from-worker',
			hostname: 'worker.example',
		})
		const read = await nativeOf(web.payload).engine.read({
			metrics: ['pageviews'],
			hostname: 'worker.example',
			dateRange: { start: calendarDayStart(TODAY, 'UTC'), end: NOW },
		})
		expect(read.totals).toEqual({ pageviews: 1 })
		await nativeOf(worker.payload).engine.idle()
		expect(await nativeOf(web.payload).state.markers('', TODAY, TODAY)).toEqual([])
	})
})
