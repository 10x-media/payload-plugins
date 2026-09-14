import { describe, expect, it } from 'vitest'
import type { SerializedCapabilities } from '../core/capabilities'
import type { MetricKey } from '../core/contract'
import { addDaysInTz, startOfDayInTz } from '../timeframe/tz'
import type { QueryErrorCode } from './errors'
import {
	DEFAULT_QUERY_LIMIT,
	MAX_QUERY_DIMENSIONS,
	MAX_QUERY_FILTER_VALUE_LENGTH,
	MAX_QUERY_FILTERS,
	MAX_QUERY_HOSTNAME_LENGTH,
	MAX_QUERY_LIMIT,
	MAX_QUERY_METRICS,
	MAX_QUERY_PATH_LENGTH,
	MAX_QUERY_RANGE_DAYS,
	type ParsedQuery,
	parseQueryParams,
} from './parse'

const NOW = new Date('2026-09-14T12:00:00.000Z')

const caps: SerializedCapabilities = {
	metrics: ['pageviews', 'visitors', 'sessions', 'conversions'],
	dimensions: ['page', 'referrer', 'country'],
	filters: ['page', 'country'],
	filterOperators: ['eq', 'contains'],
	realtime: true,
	perPageQuery: true,
	comparison: true,
	minGranularity: 'hour',
	maxLookbackDays: null,
}

const narrowCaps: SerializedCapabilities = {
	...caps,
	metrics: ['pageviews'],
	dimensions: ['page'],
	filters: [],
	filterOperators: [],
	comparison: false,
	minGranularity: 'day',
}

const BASE = 'metrics=pageviews&from=2026-09-01&to=2026-09-07'

const run = (
	search: string,
	overrides: Partial<{ capabilities: SerializedCapabilities; now: Date; timezone: string }> = {}
) =>
	parseQueryParams(new URLSearchParams(search), {
		capabilities: caps,
		now: NOW,
		timezone: 'UTC',
		...overrides,
	})

const ok = (search: string, overrides?: Parameters<typeof run>[1]): ParsedQuery => {
	const result = run(search, overrides)
	if (!result.ok) {
		throw new Error(`expected ok, got ${result.error.code} on ${result.error.param}`)
	}
	return result.value
}

const err = (search: string, overrides?: Parameters<typeof run>[1]) => {
	const result = run(search, overrides)
	if (result.ok) {
		throw new Error('expected a parse error')
	}
	return result.error
}

const filters = (value: unknown) => `${BASE}&filters=${encodeURIComponent(JSON.stringify(value))}`

describe('parseQueryParams, valid requests', () => {
	it('normalizes a minimal request', () => {
		const parsed = ok(BASE)
		expect(parsed.query.metrics).toEqual(['pageviews'])
		expect(parsed.query.limit).toBe(DEFAULT_QUERY_LIMIT)
		expect(parsed.query.timezone).toBe('UTC')
		expect(parsed.compare).toBeNull()
		expect(parsed.sourceId).toBeNull()
		expect(parsed.explicitScope).toBeNull()
		expect(parsed.query.dimensions).toBeUndefined()
		expect(parsed.query.granularity).toBeUndefined()
		expect(parsed.query.order).toBeUndefined()
		expect(parsed.query.filters).toBeUndefined()
		expect(parsed.query.path).toBeUndefined()
		expect(parsed.query.hostname).toBeUndefined()
	})

	it('omits optional keys entirely rather than setting them undefined', () => {
		const parsed = ok(BASE)
		expect(Object.keys(parsed.query).sort()).toEqual(['dateRange', 'limit', 'metrics', 'timezone'])
	})

	it('dedupes metrics preserving input order', () => {
		const parsed = ok('metrics=visitors,pageviews,visitors&from=2026-09-01&to=2026-09-07')
		expect(parsed.query.metrics).toEqual(['visitors', 'pageviews'])
	})

	it('tolerates whitespace and empty segments in the comma lists', () => {
		const parsed = ok('metrics=pageviews, visitors,&dimensions=page,&from=2026-09-01&to=2026-09-07')
		expect(parsed.query.metrics).toEqual(['pageviews', 'visitors'])
		expect(parsed.query.dimensions).toEqual(['page'])
	})

	it('dedupes dimensions', () => {
		const parsed = ok(`${BASE}&dimensions=page,page`)
		expect(parsed.query.dimensions).toEqual(['page'])
	})

	it('carries source, scope, path, hostname, granularity, order and compare through', () => {
		const parsed = ok(
			`metrics=pageviews,visitors&from=2026-09-01&to=2026-09-07&source=native&scope=tenant-a&path=/pricing&hostname=example.com&granularity=day&order=visitors:desc&compare=previous&limit=100`
		)
		expect(parsed.sourceId).toBe('native')
		expect(parsed.explicitScope).toBe('tenant-a')
		expect(parsed.compare).toBe('previous')
		expect(parsed.query.path).toBe('/pricing')
		expect(parsed.query.hostname).toBe('example.com')
		expect(parsed.query.granularity).toBe('day')
		expect(parsed.query.order).toEqual({ metric: 'visitors', direction: 'desc' })
		expect(parsed.query.limit).toBe(100)
		expect(parsed.query.scope).toBeUndefined()
	})

	it('ignores unknown params', () => {
		const parsed = ok(`${BASE}&nope=1&tab=pages`)
		expect(parsed.query.metrics).toEqual(['pageviews'])
	})

	it('parses filters and trims their values', () => {
		const parsed = ok(
			filters([
				{ dimension: 'page', operator: 'eq', value: ' /pricing ' },
				{ dimension: 'country', operator: 'contains', value: 'DE' },
			])
		)
		expect(parsed.query.filters).toEqual([
			{ dimension: 'page', operator: 'eq', value: '/pricing' },
			{ dimension: 'country', operator: 'contains', value: 'DE' },
		])
	})

	it('allows duplicate filters', () => {
		const filter = { dimension: 'page', operator: 'eq', value: '/a' }
		const parsed = ok(filters([filter, filter]))
		expect(parsed.query.filters).toHaveLength(2)
	})

	it('takes the timezone from the param when given', () => {
		const parsed = ok(`${BASE}&timezone=Europe/Berlin`)
		expect(parsed.query.timezone).toBe('Europe/Berlin')
	})

	it('accepts a limit at both bounds', () => {
		expect(ok(`${BASE}&limit=1`).query.limit).toBe(1)
		expect(ok(`${BASE}&limit=${MAX_QUERY_LIMIT}`).query.limit).toBe(MAX_QUERY_LIMIT)
	})

	it('accepts every metric key the source serves, up to the cap', () => {
		const all: MetricKey[] = [
			'pageviews',
			'visitors',
			'visits',
			'sessions',
			'bounceRate',
			'avgDuration',
			'scrollDepth',
			'events',
			'conversions',
			'revenue',
		]
		expect(all.length).toBeLessThanOrEqual(MAX_QUERY_METRICS)
		const parsed = ok(`metrics=${all.join(',')}&from=2026-09-01&to=2026-09-07`, {
			capabilities: { ...caps, metrics: all },
		})
		expect(parsed.query.metrics).toEqual(all)
	})

	it('accepts the maximum number of dimensions', () => {
		const parsed = ok(`${BASE}&dimensions=page,referrer`)
		expect(parsed.query.dimensions).toHaveLength(MAX_QUERY_DIMENSIONS)
	})

	it('accepts the maximum number of filters', () => {
		const many = Array.from({ length: MAX_QUERY_FILTERS }, () => ({
			dimension: 'page',
			operator: 'eq',
			value: '/a',
		}))
		expect(ok(filters(many)).query.filters).toHaveLength(MAX_QUERY_FILTERS)
	})

	it('accepts the finest granularity the source supports', () => {
		expect(ok(`${BASE}&granularity=hour`).query.granularity).toBe('hour')
		expect(ok(`${BASE}&granularity=month`).query.granularity).toBe('month')
	})
})

describe('parseQueryParams, date range', () => {
	it('reads a date-only range as whole days in the reporting timezone', () => {
		const { dateRange } = ok(BASE, { timezone: 'Europe/Berlin' }).query
		expect(dateRange.start.toISOString()).toBe('2026-08-31T22:00:00.000Z')
		expect(dateRange.end.toISOString()).toBe('2026-09-07T21:59:59.999Z')
	})

	it('matches the tz helpers for the same days', () => {
		const tz = 'Europe/Berlin'
		const { dateRange } = ok(BASE, { timezone: tz }).query
		const anchorFrom = new Date('2026-09-01T12:00:00.000Z')
		const anchorTo = new Date('2026-09-07T12:00:00.000Z')
		expect(dateRange.start.getTime()).toBe(startOfDayInTz(anchorFrom, tz).getTime())
		expect(dateRange.end.getTime()).toBe(addDaysInTz(anchorTo, 1, tz).getTime() - 1)
	})

	it('keeps whole days across a DST transition', () => {
		const { dateRange } = ok('metrics=pageviews&from=2026-10-25&to=2026-10-25', {
			timezone: 'Europe/Berlin',
		}).query
		expect(dateRange.start.toISOString()).toBe('2026-10-24T22:00:00.000Z')
		expect(dateRange.end.toISOString()).toBe('2026-10-25T22:59:59.999Z')
	})

	it('takes ISO datetimes as given', () => {
		const { dateRange } = ok(
			'metrics=pageviews&from=2026-09-01T06:30:00.000Z&to=2026-09-01T18:00:00.000Z',
			{ timezone: 'Europe/Berlin' }
		).query
		expect(dateRange.start.toISOString()).toBe('2026-09-01T06:30:00.000Z')
		expect(dateRange.end.toISOString()).toBe('2026-09-01T18:00:00.000Z')
	})

	it('accepts a single day and a future range', () => {
		expect(ok('metrics=pageviews&from=2026-09-01&to=2026-09-01').query.dateRange).toBeTruthy()
		expect(ok('metrics=pageviews&from=2027-01-01&to=2027-01-05').query.dateRange).toBeTruthy()
	})

	it('allows a span of exactly the maximum number of days', () => {
		expect(ok('metrics=pageviews&from=2026-01-01&to=2027-01-01').query.dateRange).toBeTruthy()
		expect(MAX_QUERY_RANGE_DAYS).toBe(366)
	})

	it('rejects a span one day longer than the maximum', () => {
		expect(err('metrics=pageviews&from=2026-01-01&to=2027-01-02')).toMatchObject({
			code: 'range_too_long',
			param: 'to',
		})
	})
})

interface ErrorCase {
	name: string
	search: string
	code: QueryErrorCode
	param: string
	capabilities?: SerializedCapabilities
}

const errorCases: ErrorCase[] = [
	{
		name: 'timezone is not an IANA zone',
		search: `${BASE}&timezone=Mars/Olympus`,
		code: 'invalid_param',
		param: 'timezone',
	},
	{
		name: 'metrics is missing',
		search: 'from=2026-09-01&to=2026-09-07',
		code: 'invalid_param',
		param: 'metrics',
	},
	{
		name: 'metrics is empty',
		search: `metrics=,,&from=2026-09-01&to=2026-09-07`,
		code: 'invalid_param',
		param: 'metrics',
	},
	{
		name: 'a metric is not a metric key at all',
		search: `metrics=pageviews,bogus&from=2026-09-01&to=2026-09-07`,
		code: 'invalid_param',
		param: 'metrics',
	},
	{
		name: 'a known metric the source lacks',
		search: `metrics=pageviews,revenue&from=2026-09-01&to=2026-09-07`,
		code: 'unsupported_metric',
		param: 'metrics',
	},
	{
		name: 'a dimension is not a dimension key at all',
		search: `${BASE}&dimensions=bogus`,
		code: 'invalid_param',
		param: 'dimensions',
	},
	{
		name: 'too many dimensions',
		search: `${BASE}&dimensions=page,referrer,country`,
		code: 'invalid_param',
		param: 'dimensions',
	},
	{
		name: 'a known dimension the source lacks',
		search: `${BASE}&dimensions=device`,
		code: 'unsupported_dimension',
		param: 'dimensions',
	},
	{
		name: 'from is missing',
		search: 'metrics=pageviews&to=2026-09-07',
		code: 'invalid_param',
		param: 'from',
	},
	{
		name: 'to is missing',
		search: 'metrics=pageviews&from=2026-09-01',
		code: 'invalid_param',
		param: 'to',
	},
	{
		name: 'from is unparseable',
		search: 'metrics=pageviews&from=yesterday&to=2026-09-07',
		code: 'invalid_param',
		param: 'from',
	},
	{
		name: 'from is not a real calendar day',
		search: 'metrics=pageviews&from=2026-02-30&to=2026-09-07',
		code: 'invalid_param',
		param: 'from',
	},
	{
		name: 'to is not a real calendar day',
		search: 'metrics=pageviews&from=2026-09-01&to=2026-13-01',
		code: 'invalid_param',
		param: 'to',
	},
	{
		name: 'to is before from',
		search: 'metrics=pageviews&from=2026-09-07&to=2026-09-01',
		code: 'invalid_param',
		param: 'to',
	},
	{
		name: 'granularity is not in the union',
		search: `${BASE}&granularity=fortnight`,
		code: 'invalid_param',
		param: 'granularity',
	},
	{
		name: 'granularity is finer than the source supports',
		search: `${BASE}&granularity=minute`,
		code: 'unsupported_granularity',
		param: 'granularity',
	},
	{
		name: 'filters is not JSON',
		search: `${BASE}&filters=%7Bnope`,
		code: 'invalid_param',
		param: 'filters',
	},
	{
		name: 'filters is not an array',
		search: `${BASE}&filters=%7B%22dimension%22%3A%22page%22%7D`,
		code: 'invalid_param',
		param: 'filters',
	},
	{
		name: 'granularity is checked before filters',
		search: `${BASE}&granularity=fortnight&filters=%7Bnope`,
		code: 'invalid_param',
		param: 'granularity',
	},
	{
		name: 'limit is not an integer',
		search: `${BASE}&limit=12.5`,
		code: 'invalid_param',
		param: 'limit',
	},
	{ name: 'limit is zero', search: `${BASE}&limit=0`, code: 'invalid_param', param: 'limit' },
	{
		name: 'limit is over the cap',
		search: `${BASE}&limit=501`,
		code: 'invalid_param',
		param: 'limit',
	},
	{ name: 'limit is negative', search: `${BASE}&limit=-5`, code: 'invalid_param', param: 'limit' },
	{
		name: 'order is malformed',
		search: `${BASE}&order=pageviews`,
		code: 'invalid_param',
		param: 'order',
	},
	{
		name: 'order direction is unknown',
		search: `${BASE}&order=pageviews:sideways`,
		code: 'invalid_param',
		param: 'order',
	},
	{
		name: 'order metric is not in metrics',
		search: `${BASE}&order=visitors:asc`,
		code: 'invalid_param',
		param: 'order',
	},
	{
		name: 'compare is not previous',
		search: `${BASE}&compare=next`,
		code: 'invalid_param',
		param: 'compare',
	},
	{
		name: 'path is too long',
		search: `${BASE}&path=/${'a'.repeat(MAX_QUERY_PATH_LENGTH)}`,
		code: 'invalid_param',
		param: 'path',
	},
	{
		name: 'hostname is too long',
		search: `${BASE}&hostname=${'h'.repeat(MAX_QUERY_HOSTNAME_LENGTH + 1)}`,
		code: 'invalid_param',
		param: 'hostname',
	},
	{
		name: 'compare is unsupported by the source',
		search: `${BASE}&compare=previous`,
		code: 'invalid_param',
		param: 'compare',
		capabilities: narrowCaps,
	},
	{
		name: 'granularity below a day-only source',
		search: `${BASE}&granularity=hour`,
		code: 'unsupported_granularity',
		param: 'granularity',
		capabilities: narrowCaps,
	},
]

describe.each(errorCases)('parseQueryParams rejects when $name', ({
	search,
	code,
	param,
	capabilities,
}) => {
	it(`reports ${code} on ${param}`, () => {
		expect(err(search, capabilities ? { capabilities } : undefined)).toMatchObject({ code, param })
	})
})

describe('parseQueryParams, filters', () => {
	it('rejects a non-object item', () => {
		expect(err(filters(['page']))).toMatchObject({ code: 'invalid_param', param: 'filters' })
	})

	it('rejects an unknown dimension with invalid_param', () => {
		expect(err(filters([{ dimension: 'bogus', operator: 'eq', value: 'x' }]))).toMatchObject({
			code: 'invalid_param',
			param: 'filters',
		})
	})

	it('rejects an unknown operator with invalid_param', () => {
		expect(err(filters([{ dimension: 'page', operator: 'startsWith', value: 'x' }]))).toMatchObject(
			{ code: 'invalid_param', param: 'filters' }
		)
	})

	it('rejects a known dimension the source cannot filter on', () => {
		expect(err(filters([{ dimension: 'referrer', operator: 'eq', value: 'x' }]))).toMatchObject({
			code: 'unsupported_filter',
			param: 'filters',
		})
	})

	it('rejects a known operator the source lacks', () => {
		expect(err(filters([{ dimension: 'page', operator: 'matches', value: 'x' }]))).toMatchObject({
			code: 'unsupported_operator',
			param: 'filters',
		})
	})

	it('rejects a non-string value', () => {
		expect(err(filters([{ dimension: 'page', operator: 'eq', value: 7 }]))).toMatchObject({
			code: 'invalid_param',
			param: 'filters',
		})
	})

	it('rejects an empty value', () => {
		expect(err(filters([{ dimension: 'page', operator: 'eq', value: '   ' }]))).toMatchObject({
			code: 'invalid_param',
			param: 'filters',
		})
	})

	it('rejects a value over the length cap', () => {
		const value = 'a'.repeat(MAX_QUERY_FILTER_VALUE_LENGTH + 1)
		expect(err(filters([{ dimension: 'page', operator: 'eq', value }]))).toMatchObject({
			code: 'invalid_param',
			param: 'filters',
		})
		const atCap = 'a'.repeat(MAX_QUERY_FILTER_VALUE_LENGTH)
		expect(
			ok(filters([{ dimension: 'page', operator: 'eq', value: atCap }])).query.filters
		).toHaveLength(1)
	})

	it('rejects more than the maximum number of filters', () => {
		const many = Array.from({ length: 11 }, () => ({
			dimension: 'page',
			operator: 'eq',
			value: '/a',
		}))
		expect(err(filters(many))).toMatchObject({ code: 'invalid_param', param: 'filters' })
	})

	it('validates items in order, reporting the first failure', () => {
		const error = err(
			filters([
				{ dimension: 'page', operator: 'eq', value: '/a' },
				{ dimension: 'referrer', operator: 'eq', value: '/b' },
				{ dimension: 'bogus', operator: 'eq', value: '/c' },
			])
		)
		expect(error).toMatchObject({ code: 'unsupported_filter', param: 'filters' })
	})

	it('reports an unknown dimension before an unsupported operator on the same item', () => {
		expect(err(filters([{ dimension: 'bogus', operator: 'matches', value: 'x' }]))).toMatchObject({
			code: 'invalid_param',
			param: 'filters',
		})
	})
})

describe('parseQueryParams, error messages', () => {
	it('truncates a rejected value rather than echoing it whole', () => {
		const error = err(`metrics=pageviews&from=${'x'.repeat(5000)}&to=2026-09-07`)
		expect(error.message.length).toBeLessThan(100)
		expect(error.message).toContain('...')
	})
})

describe('parseQueryParams, evaluation order', () => {
	it('reports the timezone before anything else', () => {
		expect(err('timezone=Mars/Olympus&from=nope&to=nope')).toMatchObject({ param: 'timezone' })
	})

	it('reports metrics before the date range', () => {
		expect(err('metrics=bogus&from=nope&to=nope')).toMatchObject({ param: 'metrics' })
	})

	it('reports dimensions before the date range', () => {
		expect(err('metrics=pageviews&dimensions=bogus&from=nope&to=nope')).toMatchObject({
			param: 'dimensions',
		})
	})

	it('reports the date range before granularity', () => {
		expect(err('metrics=pageviews&from=nope&to=2026-09-07&granularity=fortnight')).toMatchObject({
			param: 'from',
		})
	})

	it('reports filters before limit', () => {
		expect(err(`${BASE}&filters=%7Bnope&limit=0`)).toMatchObject({ param: 'filters' })
	})

	it('reports limit before order', () => {
		expect(err(`${BASE}&limit=0&order=bogus`)).toMatchObject({ param: 'limit' })
	})

	it('reports order before compare', () => {
		expect(err(`${BASE}&order=bogus&compare=next`)).toMatchObject({ param: 'order' })
	})

	it('reports compare before path', () => {
		expect(err(`${BASE}&compare=next&path=/${'a'.repeat(MAX_QUERY_PATH_LENGTH)}`)).toMatchObject({
			param: 'compare',
		})
	})

	it('reports an unknown metric before an unsupported one', () => {
		expect(err('metrics=revenue,bogus&from=2026-09-01&to=2026-09-07')).toMatchObject({
			code: 'invalid_param',
			param: 'metrics',
		})
	})
})

describe('parseQueryParams, blank params', () => {
	it('treats blank optional params as absent', () => {
		const parsed = ok(
			`${BASE}&dimensions=&granularity=&filters=&limit=&order=&compare=&path=&hostname=&source=&scope=&timezone=`
		)
		expect(parsed.query.limit).toBe(DEFAULT_QUERY_LIMIT)
		expect(parsed.query.timezone).toBe('UTC')
		expect(parsed.compare).toBeNull()
		expect(parsed.sourceId).toBeNull()
		expect(parsed.explicitScope).toBeNull()
		expect(parsed.query.dimensions).toBeUndefined()
	})
})
