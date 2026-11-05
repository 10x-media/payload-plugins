import { describe, expect, it } from 'vitest'
import type { AnalyticsQuery, AnalyticsResult, MetricKey } from './contract'
import { aliasMetrics, askedResult, readAsAsked, servedName, servedQuery } from './metricAliases'

const NATIVE: ReadonlySet<MetricKey> = new Set(['pageviews', 'sessions', 'bounceRate'])

const query: AnalyticsQuery = {
	metrics: ['visits', 'pageviews'],
	dateRange: { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-03-31T23:59:59Z') },
	order: { metric: 'visits', direction: 'desc' },
}

describe('servedName', () => {
	it('reads either name of the one count under the name the source serves', () => {
		expect(servedName('visits', NATIVE)).toBe('sessions')
		expect(servedName('sessions', ['visits'])).toBe('visits')
		expect(servedName('visits', ['visits', 'sessions'])).toBe('visits')
		expect(servedName('pageviews', NATIVE)).toBe('pageviews')
		expect(servedName('revenue', NATIVE)).toBe('revenue')
	})
})

describe('reading a count under the name asked for', () => {
	it("asks the source in its own names, the one count once, and orders by the source's name", () => {
		const aliased = aliasMetrics(['visits', 'sessions', 'pageviews'], NATIVE)
		expect(aliased.read).toEqual(['sessions', 'pageviews'])
		const served = servedQuery(query, aliasMetrics(query.metrics, NATIVE))
		expect(served.metrics).toEqual(['sessions', 'pageviews'])
		expect(served.order).toEqual({ metric: 'sessions', direction: 'desc' })
	})

	it('leaves a query the source serves as asked alone', () => {
		expect(servedQuery(query, aliasMetrics(query.metrics, ['visits', 'pageviews']))).toBe(query)
	})

	it('answers totals, rows and samples under every name asked for', () => {
		const result: AnalyticsResult = {
			rows: [
				{
					dimensions: { page: '/a' },
					metrics: { sessions: 3, bounceRate: 50 },
					samples: { bounceRate: 3 },
				},
			],
			totals: { sessions: 3, pageviews: 9 },
			meta: { provider: 'native', fetchedAt: '2026-03-31T12:00:00.000Z' },
		}
		const asked = askedResult(result, aliasMetrics(['visits', 'sessions', 'pageviews'], NATIVE))
		expect(asked.totals).toEqual({ visits: 3, sessions: 3, pageviews: 9 })
		expect(asked.rows[0]?.metrics).toEqual({ visits: 3, sessions: 3, bounceRate: 50 })
		expect(asked.rows[0]?.samples).toEqual({ bounceRate: 3 })
		expect(asked.meta).toBe(result.meta)
	})

	it('reads through any reader and answers under the asked names', async () => {
		const seen: AnalyticsQuery[] = []
		const answer = await readAsAsked(
			async (served) => {
				seen.push(served)
				return { rows: [], totals: { sessions: 4 }, meta: { provider: 'native', fetchedAt: '' } }
			},
			{ ...query, metrics: ['visits'], order: undefined },
			NATIVE
		)
		expect(seen[0]?.metrics).toEqual(['sessions'])
		expect(answer.totals).toEqual({ visits: 4 })
	})
})
