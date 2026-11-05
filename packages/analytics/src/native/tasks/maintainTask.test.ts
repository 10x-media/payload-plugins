import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { memoryStateStore } from '../store/memory/memoryState'
import { leaseKey, MAINTAIN_LEASE_NAME } from '../store/state'
import {
	beforeMaintainSchedule,
	MAINTAIN_DEAD_AFTER_MS,
	MAINTAIN_TASK_SLUG,
	type MaintainTaskOutput,
	maintainTask,
	parseMaintainInput,
} from './maintainTask'

const report: MaintainTaskOutput = {
	ran: true,
	finished: true,
	sweptSalts: 0,
	sweptRows: 0,
	discovered: 0,
	empty: 0,
	aggregated: 3,
	failed: 0,
	markedFailed: 0,
	deferred: 0,
	snapshots: 0,
	sweptOrders: 0,
	prunedHits: 0,
	expiredOrders: 0,
	prunedAggregates: 0,
	prunedMarkers: 0,
	scopesPassed: 1,
	scopesSkipped: 0,
	sweptCache: 0,
}

describe('parseMaintainInput', () => {
	it('takes no input, an empty one, and a rebuild with its instants as text or dates', () => {
		expect(parseMaintainInput(undefined)).toEqual({})
		expect(parseMaintainInput({})).toEqual({})
		expect(
			parseMaintainInput({
				rebuild: {
					from: '2026-10-01T00:00:00.000Z',
					to: new Date('2026-10-05T00:00:00.000Z'),
					scope: 'tenant-a',
					reclassify: true,
				},
			})
		).toEqual({
			rebuild: {
				from: new Date('2026-10-01T00:00:00.000Z'),
				to: new Date('2026-10-05T00:00:00.000Z'),
				scope: 'tenant-a',
				reclassify: true,
			},
		})
	})

	it('fails the job on input it cannot read, rather than running something else', () => {
		const refused: Array<[unknown, RegExp]> = [
			['rebuild', /input must be an object/],
			[{ rebuild: 'last week' }, /rebuild must be an object/],
			[
				{ rebuild: { from: 'yesterday', to: '2026-10-05T00:00:00.000Z' } },
				/rebuild\.from must be an ISO instant/,
			],
			[{ rebuild: { from: '2026-10-01T00:00:00.000Z' } }, /rebuild\.to must be an ISO instant/],
			[
				{ rebuild: { from: '2026-10-05T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' } },
				/from before to/,
			],
			[
				{ rebuild: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z', scope: 7 } },
				/rebuild\.scope must be a scope id/,
			],
			[
				{
					rebuild: {
						from: '2026-10-01T00:00:00.000Z',
						to: '2026-10-05T00:00:00.000Z',
						reclassify: 'yes',
					},
				},
				/rebuild\.reclassify must be true or false/,
			],
		]
		for (const [input, message] of refused) {
			expect(() => parseMaintainInput(input), JSON.stringify(input)).toThrow(message)
		}
	})
})

describe('maintainTask', () => {
	it('is scheduled on its queue, never retried, and hands its run the job’s request and rebuild', async () => {
		const run = vi.fn(async () => report)
		const task = maintainTask({
			schedule: { queue: 'q', cron: '0 * * * *', intervalMs: 3_600_000 },
			run,
		})
		expect(task).toMatchObject({
			slug: MAINTAIN_TASK_SLUG,
			retries: 0,
			schedule: [
				{ cron: '0 * * * *', queue: 'q', hooks: { beforeSchedule: beforeMaintainSchedule } },
			],
		})
		const req = { payload: {} } as unknown as PayloadRequest
		if (typeof task.handler !== 'function') {
			throw new Error('the task runs a function')
		}
		const result = await task.handler({
			input: { rebuild: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' } },
			req,
		} as never)
		expect(result).toEqual({ output: report })
		expect(run).toHaveBeenCalledWith(req, {
			rebuild: {
				from: new Date('2026-10-01T00:00:00.000Z'),
				to: new Date('2026-10-02T00:00:00.000Z'),
			},
		})
	})

	it('marks a run killed mid-way failed, then asks Payload whether to schedule another', async () => {
		const updateJobs = vi.fn(async () => null)
		const decision = { input: {}, shouldSchedule: true }
		const defaultBeforeSchedule = vi.fn(async () => decision)
		const req = { payload: { db: { updateJobs } } } as unknown as PayloadRequest
		const task = maintainTask({
			schedule: { queue: 'q', cron: '0 * * * *', intervalMs: 3_600_000 },
			run: async () => report,
		})
		const hook = task.schedule?.[0]?.hooks?.beforeSchedule
		expect(hook).toBe(beforeMaintainSchedule)
		const before = Date.now()
		const answer = await beforeMaintainSchedule({
			defaultBeforeSchedule,
			jobStats: {},
			queueable: { scheduleConfig: { cron: '0 * * * *', queue: 'q' } },
			req,
		} as never)
		expect(answer).toBe(decision)
		expect(defaultBeforeSchedule).toHaveBeenCalledTimes(1)
		const [args] = updateJobs.mock.calls[0] as unknown as [
			{ where: { and: Array<Record<string, Record<string, unknown>>> }; data: object },
		]
		expect(args.data).toMatchObject({ processing: false, hasError: true })
		expect(args.where.and).toContainEqual({ queue: { equals: 'q' } })
		expect(args.where.and).toContainEqual({ processing: { equals: true } })
		const cutoff = args.where.and.find((each) => 'updatedAt' in each)?.updatedAt?.less_than
		expect(Date.parse(String(cutoff))).toBeLessThanOrEqual(before - MAINTAIN_DEAD_AFTER_MS + 1000)
		expect(Date.parse(String(cutoff))).toBeGreaterThan(before - MAINTAIN_DEAD_AFTER_MS - 5000)
	})

	it('marks no job failed while a live run holds the maintenance lease, however old its job', async () => {
		const updateJobs = vi.fn(async () => null)
		const state = memoryStateStore()
		const payload = { db: { updateJobs } }
		const engine = { read: vi.fn(), realtime: vi.fn(), idle: vi.fn(), close: vi.fn() }
		const writer = { write: vi.fn(), defer: vi.fn(), flush: vi.fn(), close: vi.fn() }
		Reflect.set(payload, Symbol.for('@10x-media/analytics/native-engine'), {
			registration: {},
			nudge: () => {},
			engine,
			writer,
			salts: { forHit: vi.fn(), forDay: vi.fn() },
			state,
		})
		expect(await state.claim(leaseKey(MAINTAIN_LEASE_NAME), 'live-run', 60_000)).toBe(true)
		const decision = { input: {}, shouldSchedule: false }
		const answer = await beforeMaintainSchedule({
			defaultBeforeSchedule: async () => decision,
			jobStats: {},
			queueable: { scheduleConfig: { cron: '0 * * * *', queue: 'q' } },
			req: { payload } as unknown as PayloadRequest,
		} as never)
		expect(answer).toBe(decision)
		expect(updateJobs).not.toHaveBeenCalled()
		await state.release(leaseKey(MAINTAIN_LEASE_NAME), 'live-run')
		await beforeMaintainSchedule({
			defaultBeforeSchedule: async () => decision,
			jobStats: {},
			queueable: { scheduleConfig: { cron: '0 * * * *', queue: 'q' } },
			req: { payload } as unknown as PayloadRequest,
		} as never)
		expect(updateJobs).toHaveBeenCalledTimes(1)
	})

	it('keys a rebuild apart from upkeep, so a scheduled run never replaces one someone queued', () => {
		const task = maintainTask({
			schedule: { queue: 'q', cron: '0 * * * *', intervalMs: 3_600_000 },
			run: async () => report,
			concurrency: true,
		})
		const concurrency = task.concurrency
		if (typeof concurrency !== 'object') {
			throw new Error('expected the object form')
		}
		expect(concurrency).toMatchObject({ exclusive: true, supersedes: false })
		expect(concurrency.key({ input: {}, queue: 'q' })).toBe('analytics:maintain')
		expect(
			concurrency.key({
				input: {
					rebuild: { scope: 'a', from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' },
				},
				queue: 'q',
			})
		).toBe('analytics:maintain:rebuild:a:2026-10-01T00:00:00.000Z:2026-10-02T00:00:00.000Z')
		expect(
			maintainTask({
				schedule: { queue: 'q', cron: '0 * * * *', intervalMs: 3_600_000 },
				run: async () => report,
			}).concurrency
		).toBeUndefined()
	})

	it('registers without a schedule when its cron is off', () => {
		const task = maintainTask({
			schedule: { queue: 'default', cron: null, intervalMs: 1 },
			run: async () => report,
		})
		expect(task.schedule).toBeUndefined()
	})
})
