import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsRow } from '../core/contract'
import { TASK_DEAD_AFTER_MS } from '../maintenance/taskSchedule'
import {
	matchesAdapterFilter,
	rotateScopes,
	SYNC_TASK_SLUG,
	syncTask,
	toSyncRow,
	upsertSyncRow,
} from './syncTask'

const now = new Date('2026-06-24T12:00:00.000Z')

describe('toSyncRow', () => {
	it('maps a daily row to a doc: date from timestamp, present metrics, syncedAt, scope', () => {
		const row: AnalyticsRow = {
			timestamp: '2026-06-20T00:00:00.000Z',
			metrics: { pageviews: 12, visitors: 8 },
		}
		expect(toSyncRow('plausible', row, { syncedAt: now })).toEqual({
			source: 'plausible',
			date: new Date('2026-06-20T00:00:00.000Z'),
			syncedAt: now,
			scope: '',
			pageviews: 12,
			visitors: 8,
			sessions: null,
			avgDuration: null,
			visitDuration: null,
			bounceRate: null,
			events: null,
		})
	})

	it('stamps the resolved scope when one is passed', () => {
		const row: AnalyticsRow = {
			timestamp: '2026-06-20T00:00:00.000Z',
			metrics: { pageviews: 1 },
		}
		expect(toSyncRow('plausible', row, { syncedAt: now, scope: 't1' })?.scope).toBe('t1')
	})

	it('writes null for a metric the row does not report, so a day synced again loses an old value', () => {
		const row: AnalyticsRow = { timestamp: '2026-06-20T00:00:00.000Z', metrics: { pageviews: 3 } }
		const doc = toSyncRow('umami', row, { syncedAt: now })
		expect(doc?.pageviews).toBe(3)
		expect(doc?.visitors).toBeNull()
		expect(doc?.bounceRate).toBeNull()
		expect(doc?.avgDuration).toBeNull()
	})

	it('returns null for a row with a missing or unparseable timestamp', () => {
		expect(toSyncRow('x', { metrics: { pageviews: 1 } }, { syncedAt: now })).toBeNull()
		expect(
			toSyncRow('x', { timestamp: 'not-a-date', metrics: { pageviews: 1 } }, { syncedAt: now })
		).toBeNull()
	})

	it('ignores non-numeric metric values', () => {
		const row = {
			timestamp: '2026-06-20T00:00:00.000Z',
			metrics: { pageviews: 5, visitors: undefined },
		}
		const doc = toSyncRow('x', row as AnalyticsRow, { syncedAt: now })
		expect(doc?.pageviews).toBe(5)
		expect(doc?.visitors).toBeNull()
	})
})

describe('matchesAdapterFilter', () => {
	it('is unfiltered when adapterIds is unset', () => {
		expect(matchesAdapterFilter(undefined, 'plausible:abc')).toBe(true)
	})

	it('matches a runtime instance id by its provider prefix', () => {
		expect(matchesAdapterFilter(['plausible'], 'plausible:abc')).toBe(true)
		expect(matchesAdapterFilter(['plausible'], 'posthog:def')).toBe(false)
	})

	it('matches a config adapter id exactly', () => {
		expect(matchesAdapterFilter(['plausible'], 'plausible')).toBe(true)
		expect(matchesAdapterFilter(['plausible'], 'umami')).toBe(false)
	})
})

describe('upsertSyncRow', () => {
	const row = {
		source: 'plausible',
		date: new Date('2026-06-20T00:00:00.000Z'),
		syncedAt: now,
		scope: 't1',
		pageviews: 12,
	}
	const payloadWith = (upsert: ReturnType<typeof vi.fn>) =>
		({
			collections: { 'analytics-daily': {} },
			config: { i18n: { supportedLanguages: {}, translations: {} } },
			db: { upsert },
		}) as unknown as Payload

	it('writes one row in one statement on the unique (source, date, scope), outside any transaction', async () => {
		const upsert = vi.fn(async () => null)
		await upsertSyncRow(payloadWith(upsert), 'analytics-daily', row)
		expect(upsert).toHaveBeenCalledTimes(1)
		expect(upsert).toHaveBeenCalledWith({
			collection: 'analytics-daily',
			data: {
				source: 'plausible',
				date: '2026-06-20T00:00:00.000Z',
				syncedAt: now.toISOString(),
				updatedAt: now.toISOString(),
				scope: 't1',
				pageviews: 12,
			},
			req: {},
			returning: false,
			select: {},
			where: {
				and: [
					{ source: { equals: 'plausible' } },
					{ date: { equals: '2026-06-20T00:00:00.000Z' } },
					{ scope: { equals: 't1' } },
				],
			},
		})
	})

	it('writes again once when another run inserted the same row first', async () => {
		const upsert = vi
			.fn()
			.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }))
			.mockResolvedValue(null)
		await upsertSyncRow(payloadWith(upsert), 'analytics-daily', row)
		expect(upsert).toHaveBeenCalledTimes(2)
	})

	it('throws any other failure, and refuses a collection that is not registered', async () => {
		const upsert = vi.fn().mockRejectedValue(new Error('connection lost'))
		await expect(upsertSyncRow(payloadWith(upsert), 'analytics-daily', row)).rejects.toThrow(
			'connection lost'
		)
		expect(upsert).toHaveBeenCalledTimes(1)
		await expect(upsertSyncRow(payloadWith(upsert), 'elsewhere', row)).rejects.toThrow(
			/no "elsewhere" collection is registered for sync/
		)
	})
})

describe('rotateScopes', () => {
	const scopes = [null, 'a', 'b', 'c']

	it('starts at the scope the last run stopped at, the ones before it last', () => {
		expect(rotateScopes(scopes, '"b"')).toEqual(['b', 'c', null, 'a'])
		expect(rotateScopes(scopes, 'null')).toEqual([null, 'a', 'b', 'c'])
	})

	it('starts at the first scope after a run that finished, or when the scope is gone', () => {
		expect(rotateScopes(scopes, null)).toEqual(scopes)
		expect(rotateScopes(scopes, '"gone"')).toEqual(scopes)
	})
})

describe('syncTask', () => {
	const schedule = { queue: 'analytics', cron: '0 */6 * * *', intervalMs: 6 * 3_600_000 }

	it('is analytics-sync on its queue, unscheduled with cron null', () => {
		const task = syncTask({ schedule, lookbackDays: 3, collectionSlug: 'analytics-daily' })
		expect(task.slug).toBe(SYNC_TASK_SLUG)
		expect(task.slug).toBe('analytics-sync')
		expect(task.schedule).toMatchObject([{ cron: '0 */6 * * *', queue: 'analytics' }])
		expect(
			syncTask({
				schedule: { ...schedule, cron: null },
				lookbackDays: 3,
				collectionSlug: 'analytics-daily',
			}).schedule
		).toBeUndefined()
	})

	it('marks its own killed runs failed once their budget and a margin passed, before Payload schedules another', async () => {
		const task = syncTask({ schedule, lookbackDays: 3, collectionSlug: 'analytics-daily' })
		const hook = task.schedule?.[0]?.hooks?.beforeSchedule
		const updateJobs = vi.fn(async () => null)
		const decision = { input: {}, shouldSchedule: true }
		const payload = { collections: {}, db: { updateJobs } } as unknown as Payload
		const before = Date.now()
		const answer = await hook?.({
			defaultBeforeSchedule: async () => decision,
			jobStats: {},
			queueable: { scheduleConfig: { cron: '0 */6 * * *', queue: 'analytics' } },
			req: { payload } as PayloadRequest,
		} as never)
		expect(answer).toBe(decision)
		const [update] = updateJobs.mock.calls[0] as unknown as [
			{ where: { and: Array<Record<string, Record<string, unknown>>> } },
		]
		expect(update.where.and).toContainEqual({ taskSlug: { equals: 'analytics-sync' } })
		const cutoff = update.where.and.find((each) => 'updatedAt' in each)?.updatedAt?.less_than
		expect(Date.parse(String(cutoff))).toBeLessThanOrEqual(before - TASK_DEAD_AFTER_MS + 1000)
	})
})
