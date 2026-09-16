import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsCapabilities, MetricKey } from '../core/contract'
import { createRegistry } from '../core/registry'
import { type AnalyticsRuntime, setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { prepareWidgetRead } from './prepareWidgetRead'

const NOW = new Date('2026-06-01T00:00:00Z')

const reqWith = (
	adapters: AnalyticsAdapter[],
	runtime: Partial<AnalyticsRuntime> = {}
): PayloadRequest => {
	const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry(adapters),
		configAdapterIds: new Set(adapters.map((a) => a.id)),
		bindings: {},
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: true,
		...runtime,
	} as AnalyticsRuntime)
	return { payload } as PayloadRequest
}

const withCapabilities = (
	overrides: Partial<AnalyticsCapabilities>,
	isConfigured = true
): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		id: 'test',
		capabilities: { ...base.capabilities, ...overrides },
		isConfigured: () => isConfigured,
	}
}

describe('prepareWidgetRead', () => {
	it('refuses without a runtime, keeping the window the caller asked for', async () => {
		const prepared = await prepareWidgetRead({
			req: { payload: {} } as PayloadRequest,
			now: NOW,
			timeframe: 'last30days',
			adapterId: 'plausible',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'unavailable', adapterId: 'plausible' })
		if (prepared.ok) return
		expect(prepared.dateRange.end).toBeInstanceOf(Date)
		expect(prepared.tz).toBe('UTC')
	})

	it('refuses an unconfigured source by its own id', async () => {
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({}, false)]),
			now: NOW,
			timeframe: 'last30days',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'not-configured', adapterId: 'test' })
	})

	it('refuses an unconfigured source in the resolved timezone, not the caller default', async () => {
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({}, false)], {
				resolveTimezone: () => Promise.resolve('Europe/Berlin'),
			}),
			now: NOW,
			timeframe: 'today',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'not-configured', tz: 'Europe/Berlin' })
		if (prepared.ok) return
		expect(prepared.dateRange.start.toISOString()).toBe('2026-05-31T22:00:00.000Z')
	})

	it('refuses a source that does not serve what the read needs', async () => {
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({ metrics: new Set(['pageviews']) })]),
			now: NOW,
			timeframe: 'last30days',
			requires: { metrics: ['conversions'] },
		})
		expect(prepared).toMatchObject({ ok: false, status: 'unavailable' })
	})

	it('refuses a bucket finer than the source can serve', async () => {
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({ minGranularity: 'month' })]),
			now: NOW,
			timeframe: 'last30days',
			granularity: 'day',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'unavailable' })
	})

	it('refuses a filter the source cannot apply, rather than reading past it', async () => {
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({})]),
			now: NOW,
			timeframe: 'last30days',
			filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
		})
		expect(prepared).toMatchObject({ ok: false, status: 'filter-unsupported', adapterId: 'test' })
	})

	it('resolves the reporting timezone and reads the window in it', async () => {
		const resolveTimezone = vi.fn(() => Promise.resolve('Europe/Berlin'))
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({})], { resolveTimezone }),
			now: NOW,
			timeframe: 'today',
		})
		expect(prepared.ok).toBe(true)
		if (!prepared.ok) return
		expect(prepared.tz).toBe('Europe/Berlin')
		// Berlin is two hours ahead of UTC in June, so its day starts before UTC midnight.
		expect(prepared.dateRange.start.toISOString()).toBe('2026-05-31T22:00:00.000Z')
		expect(resolveTimezone).toHaveBeenCalledTimes(1)
	})

	it('keeps an explicit window instead of resolving the preset', async () => {
		const range = { start: new Date('2026-05-01T00:00:00Z'), end: new Date('2026-05-02T00:00:00Z') }
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({})]),
			now: NOW,
			timeframe: 'last30days',
			range,
		})
		expect(prepared.ok && prepared.dateRange).toEqual(range)
	})

	it('hints the scope goal slugs for a read that asks about goals', async () => {
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({})], {
				goals: [{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } }],
			}),
			now: NOW,
			timeframe: 'last30days',
			goalRead: () => ({ metrics: ['conversions'] }),
		})
		expect(prepared.ok && prepared.goalSlugs).toEqual(['signup'])
	})

	it('leaves the hint off a read that asks about no goals', async () => {
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({})], {
				goals: [{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } }],
			}),
			now: NOW,
			timeframe: 'last30days',
			goalRead: () => ({ metrics: ['pageviews'] }),
		})
		expect(prepared.ok && 'goalSlugs' in prepared).toBe(false)
	})

	it('hints unresolved when the goal resolver throws', async () => {
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({})], {
				resolveGoals: () => Promise.reject(new Error('boom')),
			}),
			now: NOW,
			timeframe: 'last30days',
			goalRead: () => ({ metrics: ['conversions'] }),
		})
		expect(prepared.ok && prepared.goalSlugs).toBe('unresolved')
	})

	it('answers the goal read with the adapter, so a caller can narrow its metrics first', async () => {
		const goalRead = vi.fn((adapter: AnalyticsAdapter) => ({
			metrics: [...adapter.capabilities.metrics],
		}))
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({ metrics: new Set<MetricKey>(['conversions']) })], {
				goals: [{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } }],
			}),
			now: NOW,
			timeframe: 'last30days',
			goalRead,
		})
		expect(goalRead.mock.calls[0]?.[0]?.id).toBe('test')
		// The hint followed the adapter's own metric list, which is where conversions came from.
		expect(prepared.ok && prepared.goalSlugs).toEqual(['signup'])
	})

	it('takes a hint the caller already resolved over resolving one itself', async () => {
		const goalRead = vi.fn(() => ({ metrics: ['conversions'] as MetricKey[] }))
		const prepared = await prepareWidgetRead({
			req: reqWith([withCapabilities({})], {
				goals: [{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } }],
			}),
			now: NOW,
			timeframe: 'last30days',
			goalSlugs: 'unresolved',
			goalRead,
		})
		expect(prepared.ok && prepared.goalSlugs).toBe('unresolved')
		expect(goalRead).not.toHaveBeenCalled()
	})
})
