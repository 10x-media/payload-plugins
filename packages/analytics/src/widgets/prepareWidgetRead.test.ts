import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsCapabilities, MetricKey } from '../core/contract'
import { memoryAdapter } from '../testing/memoryAdapter'
import { prepareWidgetRead } from './prepareWidgetRead'
import { requestWith } from './widgetTestKit'

const NOW = new Date('2026-06-01T00:00:00Z')

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

	it('shows a reader access.read denies the no-access state, without reading', async () => {
		const adapter = withCapabilities({})
		const query = vi.spyOn(adapter, 'query')
		const prepared = await prepareWidgetRead({
			req: requestWith([adapter], { readAccess: () => false }),
			now: NOW,
			timeframe: 'last30days',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'no-access' })
		expect(query).not.toHaveBeenCalled()
	})

	it('shows the no-access state for a tenant the user does not belong to', async () => {
		const adapter = withCapabilities({ scopedQueries: true })
		const prepared = await prepareWidgetRead({
			req: requestWith([adapter], {
				scoped: true,
				resolveScope: async () => 'beta',
				member: () => false,
				crossScope: { named: () => false, aggregate: () => false, unscopedSource: () => false },
			}),
			now: NOW,
			timeframe: 'last30days',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'no-access' })
	})

	// A tenant admin with no site selected reads no site, which is not the source's fault.
	it('asks for a site when a per-site reader has none selected', async () => {
		const adapter = withCapabilities({ scopedQueries: true })
		const query = vi.spyOn(adapter, 'query')
		const prepared = await prepareWidgetRead({
			req: requestWith([adapter], {
				scoped: true,
				resolveScope: async () => null,
				member: () => true,
				crossScope: { named: () => false, aggregate: () => false, unscopedSource: () => false },
			}),
			now: NOW,
			timeframe: 'last30days',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'no-scope' })
		expect(query).not.toHaveBeenCalled()
	})

	it('refuses an unconfigured source by its own id', async () => {
		const prepared = await prepareWidgetRead({
			req: requestWith([withCapabilities({}, false)]),
			now: NOW,
			timeframe: 'last30days',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'not-configured', adapterId: 'test' })
	})

	it('refuses an unconfigured source in the resolved timezone, not the caller default', async () => {
		const prepared = await prepareWidgetRead({
			req: requestWith([withCapabilities({}, false)], {
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
			req: requestWith([withCapabilities({ metrics: new Set(['pageviews']) })]),
			now: NOW,
			timeframe: 'last30days',
			requires: { metrics: ['conversions'] },
		})
		expect(prepared).toMatchObject({ ok: false, status: 'unavailable' })
	})

	it('refuses a bucket finer than the source can serve', async () => {
		const prepared = await prepareWidgetRead({
			req: requestWith([withCapabilities({ minGranularity: 'month' })]),
			now: NOW,
			timeframe: 'last30days',
			granularity: 'day',
		})
		expect(prepared).toMatchObject({ ok: false, status: 'unavailable' })
	})

	it('refuses a filter the source cannot apply, rather than reading past it', async () => {
		const prepared = await prepareWidgetRead({
			req: requestWith([withCapabilities({})]),
			now: NOW,
			timeframe: 'last30days',
			filters: [{ dimension: 'country', operator: 'eq', value: 'DE' }],
		})
		expect(prepared).toMatchObject({ ok: false, status: 'filter-unsupported', adapterId: 'test' })
	})

	it('resolves the reporting timezone and reads the window in it', async () => {
		const resolveTimezone = vi.fn(() => Promise.resolve('Europe/Berlin'))
		const prepared = await prepareWidgetRead({
			req: requestWith([withCapabilities({})], { resolveTimezone }),
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
			req: requestWith([withCapabilities({})]),
			now: NOW,
			timeframe: 'last30days',
			range,
		})
		expect(prepared.ok && prepared.dateRange).toEqual(range)
	})

	it('hints the scope goal slugs for a read that asks about goals', async () => {
		const prepared = await prepareWidgetRead({
			req: requestWith([withCapabilities({})], {
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
			req: requestWith([withCapabilities({})], {
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
			req: requestWith([withCapabilities({})], {
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
			req: requestWith([withCapabilities({ metrics: new Set<MetricKey>(['conversions']) })], {
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
			req: requestWith([withCapabilities({})], {
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
