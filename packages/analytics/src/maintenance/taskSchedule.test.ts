import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { concurrencyFor, scheduleFor, stuckJobGuard, TASK_DEAD_AFTER_MS } from './taskSchedule'

const hookArgs = (updateJobs: ReturnType<typeof vi.fn>) => {
	const decision = { input: {}, shouldSchedule: true }
	const defaultBeforeSchedule = vi.fn(async () => decision)
	const req = { payload: { db: { updateJobs } } } as unknown as PayloadRequest
	return {
		decision,
		defaultBeforeSchedule,
		args: {
			defaultBeforeSchedule,
			jobStats: {},
			queueable: { scheduleConfig: { cron: '0 * * * *', queue: 'q' } },
			req,
		} as never,
	}
}

type UpdateArgs = { where: { and: Array<Record<string, Record<string, unknown>>> }; data: object }

describe('stuckJobGuard', () => {
	it('marks the task’s jobs processing past the cutoff failed, then asks Payload', async () => {
		const updateJobs = vi.fn(async () => null)
		const { args, decision, defaultBeforeSchedule } = hookArgs(updateJobs)
		const guard = stuckJobGuard({ slug: 'analytics-sync', deadAfterMs: TASK_DEAD_AFTER_MS })
		const before = Date.now()
		expect(await guard(args)).toBe(decision)
		expect(defaultBeforeSchedule).toHaveBeenCalledTimes(1)
		const [update] = updateJobs.mock.calls[0] as unknown as [UpdateArgs]
		expect(update.data).toMatchObject({ processing: false, hasError: true })
		expect(update.where.and).toContainEqual({ taskSlug: { equals: 'analytics-sync' } })
		expect(update.where.and).toContainEqual({ queue: { equals: 'q' } })
		const cutoff = update.where.and.find((each) => 'updatedAt' in each)?.updatedAt?.less_than
		expect(Date.parse(String(cutoff))).toBeLessThanOrEqual(before - TASK_DEAD_AFTER_MS + 1000)
		expect(Date.parse(String(cutoff))).toBeGreaterThan(before - TASK_DEAD_AFTER_MS - 5000)
	})

	it('marks nothing while a live run holds the task’s lease', async () => {
		const updateJobs = vi.fn(async () => null)
		const { args, decision } = hookArgs(updateJobs)
		const alive = vi.fn(async () => true)
		const guard = stuckJobGuard({ slug: 'analytics-warm', deadAfterMs: 1, alive })
		expect(await guard(args)).toBe(decision)
		expect(alive).toHaveBeenCalledTimes(1)
		expect(updateJobs).not.toHaveBeenCalled()
	})

	it('falls back to the cutoff where no lease says whether a run lives', async () => {
		for (const answer of [false, undefined]) {
			const updateJobs = vi.fn(async () => null)
			const { args } = hookArgs(updateJobs)
			await stuckJobGuard({ slug: 'analytics-warm', deadAfterMs: 1, alive: async () => answer })(
				args
			)
			expect(updateJobs).toHaveBeenCalledTimes(1)
		}
	})
})

describe('scheduleFor', () => {
	it('schedules a task on its queue behind its guard, and leaves an unscheduled one bare', () => {
		const guard = stuckJobGuard({ slug: 'x', deadAfterMs: 1 })
		expect(
			scheduleFor({ queue: 'analytics', cron: '0 * * * *', intervalMs: 3_600_000 }, guard)
		).toEqual({
			schedule: [{ cron: '0 * * * *', queue: 'analytics', hooks: { beforeSchedule: guard } }],
		})
		expect(scheduleFor({ queue: 'analytics', cron: null, intervalMs: 1 }, guard)).toEqual({})
	})
})

describe('concurrencyFor', () => {
	it('keys a task as analytics:<task>, exclusive and never deleting older runs, only where it is allowed', () => {
		expect(concurrencyFor('sync', false)).toEqual({})
		const { concurrency } = concurrencyFor('warm', true)
		if (typeof concurrency !== 'object') {
			throw new Error('expected the object form')
		}
		expect(concurrency.key({ input: {}, queue: 'default' })).toBe('analytics:warm')
		expect(concurrency).toMatchObject({ exclusive: true, supersedes: false })
		const keyed = concurrencyFor('maintain', true, () => 'analytics:maintain:rebuild:a:b:c')
		if (typeof keyed.concurrency !== 'object') {
			throw new Error('expected the object form')
		}
		expect(keyed.concurrency.key({ input: {}, queue: 'q' })).toBe(
			'analytics:maintain:rebuild:a:b:c'
		)
	})
})
