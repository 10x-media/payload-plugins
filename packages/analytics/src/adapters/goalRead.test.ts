import { describe, expect, it } from 'vitest'
import type { AnalyticsQuery, AnalyticsResult, MetricKey } from '../core/contract'
import {
	emptyGoalBreakdown,
	type GoalHint,
	type GoalKeyedRow,
	goalHint,
	goalsUnresolvedResult,
	hintFailed,
	hintSlugs,
	mergeGoalRows,
	mergeGoalTotals,
	providerMetricKeys,
	readGoalPair,
	splitGoalMetrics,
} from './goalRead'

const q = (over: Partial<AnalyticsQuery> = {}): AnalyticsQuery => ({
	metrics: ['pageviews'],
	dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T00:00:00Z') },
	...over,
})

const row = (keys: string[], metrics: Partial<Record<MetricKey, number>>): GoalKeyedRow => ({
	keys,
	metrics,
})

describe('goalHint', () => {
	it('dedupes the slugs and drops the empty ones', () => {
		expect(goalHint(q({ goalSlugs: ['a', 'a', '', 'b'] }))).toEqual({ slugs: ['a', 'b'] })
	})

	it('tells a scope with no goals apart from a resolver that failed', () => {
		expect(goalHint(q({ goalSlugs: [] }))).toEqual({ slugs: [] })
		expect(goalHint(q({ goalSlugs: [''] }))).toEqual({ slugs: [] })
		expect(goalHint(q({ goalSlugs: 'unresolved' }))).toBe('unresolved')
	})

	it('is null when the read carries no hint at all', () => {
		expect(goalHint(q())).toBeNull()
	})
})

describe('hintSlugs', () => {
	it('is the list only when there is one to filter by', () => {
		expect(hintSlugs({ slugs: ['signup'] })).toEqual(['signup'])
		expect(hintSlugs({ slugs: [] })).toBeNull()
		expect(hintSlugs('unresolved')).toBeNull()
		expect(hintSlugs(null)).toBeNull()
	})
})

describe('hintFailed', () => {
	it('is a failed or absent hint, never an install with no goals', () => {
		expect(hintFailed('unresolved')).toBe(true)
		expect(hintFailed(null)).toBe(true)
		expect(hintFailed({ slugs: [] })).toBe(false)
		expect(hintFailed({ slugs: ['signup'] })).toBe(false)
	})
})

describe('emptyGoalBreakdown', () => {
	const breakdown = (hint: GoalHint): AnalyticsResult | null =>
		emptyGoalBreakdown({ provider: 'umami', q: q(), hint })

	it('flags the rows it cannot define when the hint failed or was never set', () => {
		expect(breakdown('unresolved')?.meta.goalsUnresolved).toBe(true)
		expect(breakdown(null)?.meta.goalsUnresolved).toBe(true)
	})

	it('answers empty rows without the flag for a scope that configured no goals', () => {
		const result = breakdown({ slugs: [] })
		expect(result?.rows).toEqual([])
		expect(result?.meta).toEqual({ provider: 'umami', fetchedAt: '2026-01-31T00:00:00.000Z' })
	})

	it('lets the adapter read when the hint names rows', () => {
		expect(breakdown({ slugs: ['signup'] })).toBeNull()
	})
})

describe('goalsUnresolvedResult', () => {
	it('carries the meta the read still has to report', () => {
		const unappliedFilters = [
			{ dimension: 'country' as const, operator: 'eq' as const, value: 'DE' },
		]
		const result = goalsUnresolvedResult('umami', q(), { unappliedFilters })
		expect(result.rows).toEqual([])
		expect(result.meta).toEqual({
			provider: 'umami',
			fetchedAt: '2026-01-31T00:00:00.000Z',
			unappliedFilters,
			goalsUnresolved: true,
		})
	})
})

describe('splitGoalMetrics', () => {
	const goalOnly: ReadonlySet<MetricKey> = new Set<MetricKey>(['conversions', 'revenue'])

	it('sends every metric in the one request a goal breakdown makes', () => {
		expect(
			splitGoalMetrics({
				wanted: ['conversions', 'visitors'],
				goalOnly,
				goalBreakdown: true,
				hint: { slugs: ['signup'] },
			})
		).toEqual({ siteMetrics: ['conversions', 'visitors'], goalMetrics: [], unresolved: false })
	})

	it('splits a mixed read into a site half and a goal half', () => {
		expect(
			splitGoalMetrics({
				wanted: ['pageviews', 'conversions', 'revenue'],
				goalOnly,
				goalBreakdown: false,
				hint: { slugs: ['signup'] },
			})
		).toEqual({
			siteMetrics: ['pageviews'],
			goalMetrics: ['conversions', 'revenue'],
			unresolved: false,
		})
	})

	it('keeps the site half and reports unresolved when the hint failed or is absent', () => {
		for (const hint of [null, 'unresolved'] as const) {
			expect(
				splitGoalMetrics({
					wanted: ['pageviews', 'conversions'],
					goalOnly,
					goalBreakdown: false,
					hint,
				})
			).toEqual({ siteMetrics: ['pageviews'], goalMetrics: [], unresolved: true })
		}
	})

	it('drops the goal half without reporting unresolved when the scope has no goals', () => {
		expect(
			splitGoalMetrics({
				wanted: ['pageviews', 'conversions'],
				goalOnly,
				goalBreakdown: false,
				hint: { slugs: [] },
			})
		).toEqual({ siteMetrics: ['pageviews'], goalMetrics: [], unresolved: false })
	})

	it('is resolved when the read wanted no goal metric at all', () => {
		expect(
			splitGoalMetrics({ wanted: ['pageviews'], goalOnly, goalBreakdown: false, hint: null })
				.unresolved
		).toBe(false)
	})
})

describe('providerMetricKeys', () => {
	it('dedupes contract metrics that alias one provider metric', () => {
		expect(
			providerMetricKeys(['visits', 'sessions', 'pageviews'], {
				visits: 'visits',
				sessions: 'visits',
				pageviews: 'pageviews',
			})
		).toEqual(['visits', 'pageviews'])
	})
})

describe('mergeGoalRows', () => {
	it('merges the goal metrics onto the site row sharing its key', () => {
		expect(
			mergeGoalRows([row(['/a'], { pageviews: 90 })], [row(['/a'], { conversions: 4 })])
		).toEqual([row(['/a'], { pageviews: 90, conversions: 4 })])
	})

	it('keeps a site-only row without conversions and appends a goal-only row after it', () => {
		expect(
			mergeGoalRows(
				[row(['/a'], { pageviews: 90 }), row(['/b'], { pageviews: 30 })],
				[row(['/a'], { conversions: 4 }), row(['/c'], { conversions: 1 })]
			)
		).toEqual([
			row(['/a'], { pageviews: 90, conversions: 4 }),
			row(['/b'], { pageviews: 30 }),
			row(['/c'], { conversions: 1 }),
		])
	})

	it('keys on the whole dimension tuple', () => {
		expect(
			mergeGoalRows([row(['/a', 'DE'], { pageviews: 9 })], [row(['/a', 'AT'], { conversions: 1 })])
		).toEqual([row(['/a', 'DE'], { pageviews: 9 }), row(['/a', 'AT'], { conversions: 1 })])
	})

	it('unions the totals row, which keys on the empty tuple', () => {
		expect(mergeGoalRows([row([], { pageviews: 500 })], [row([], { conversions: 11 })])).toEqual([
			row([], { pageviews: 500, conversions: 11 }),
		])
	})

	it('serves whichever half ran when the other made no request', () => {
		expect(mergeGoalRows(undefined, [row(['/a'], { conversions: 1 })])).toEqual([
			row(['/a'], { conversions: 1 }),
		])
		expect(mergeGoalRows([row(['/a'], { pageviews: 9 })], undefined)).toEqual([
			row(['/a'], { pageviews: 9 }),
		])
		expect(mergeGoalRows(undefined, undefined)).toEqual([])
	})
})

describe('mergeGoalTotals', () => {
	it('unions the two halves and stays undefined when neither ran', () => {
		expect(mergeGoalTotals({ pageviews: 500 }, { conversions: 11 })).toEqual({
			pageviews: 500,
			conversions: 11,
		})
		expect(mergeGoalTotals({ pageviews: 500 }, undefined)).toEqual({ pageviews: 500 })
		expect(mergeGoalTotals(undefined, undefined)).toBeUndefined()
	})
})

describe('readGoalPair', () => {
	it('runs the site request before the goal request', async () => {
		const order: string[] = []
		const pair = await readGoalPair({
			site: async () => {
				order.push('site')
				return 'site'
			},
			goals: async () => {
				order.push('goals')
				return 'goals'
			},
		})
		expect(order).toEqual(['site', 'goals'])
		expect(pair).toEqual({ site: 'site', goals: 'goals', failed: false })
	})

	it('keeps the site half and reports the failure when the goal request rejects', async () => {
		const pair = await readGoalPair({
			site: async () => 'site',
			goals: () => Promise.reject(new Error('no such goal')),
		})
		expect(pair).toEqual({ site: 'site', goals: undefined, failed: true })
	})

	it('rethrows when the goal request is the only request there is', async () => {
		await expect(
			readGoalPair({ site: undefined, goals: () => Promise.reject(new Error('no such goal')) })
		).rejects.toThrow('no such goal')
	})
})
