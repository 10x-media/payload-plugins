import { describe, expect, it } from 'vitest'
import type { AnalyticsFilter } from '../../core/contract'
import { AGGREGATION_VERSION } from '../store/aggregate'
import type { DayMarker } from '../store/types'
import { localDay } from './days'
import {
	axisOf,
	closedDaySource,
	countsVisits,
	foldTargets,
	holdsWholeDay,
	orderOf,
	readFilters,
	readShape,
	runsOf,
	seriesOf,
	snapshotState,
	wholeDayHits,
} from './planner'

const END = new Date('2026-10-06T00:00:00.000Z')
const MINUTE = 60_000

const marker = (over: Partial<DayMarker> = {}): DayMarker => ({
	scope: 's',
	day: 20261005,
	tz: 'UTC',
	start: null,
	status: 'provisional',
	version: AGGREGATION_VERSION,
	gen: 'G1',
	hits: 120,
	leaseOwner: null,
	leaseUntil: null,
	finalAfter: new Date('2026-10-07T00:15:00.000Z'),
	aggregatedAt: new Date('2026-10-06T00:20:00.000Z'),
	...over,
})

/** 20261005's own window in UTC, which ends at END. */
const OWN = localDay(20261005, 'UTC')

const source = (
	found: DayMarker | undefined,
	more: { tz?: string; fixed?: boolean; start?: Date } = {}
) =>
	closedDaySource({
		marker: found,
		tz: more.tz ?? 'UTC',
		window: { ...OWN, ...(more.start ? { start: more.start } : {}) },
		fixed: more.fixed ?? false,
	})

const eq = (dimension: AnalyticsFilter['dimension'], value: string): AnalyticsFilter => ({
	dimension,
	operator: 'eq',
	value,
})

describe('where a closed day is read from', () => {
	it.each([
		['a provisional day of the current version and zone', marker(), 'aggregates'],
		['a final day', marker({ status: 'final' }), 'aggregates'],
		['a stale version', marker({ version: AGGREGATION_VERSION - 1 }), 'aggregate'],
		['another zone', marker({ tz: 'America/New_York' }), 'aggregate'],
		['an open day, never aggregated', marker({ status: 'open', gen: null }), 'aggregate'],
		['a dirty day', marker({ status: 'dirty' }), 'aggregate'],
		['a day without a marker', undefined, 'probe'],
		['a day marked empty in its zone', marker({ status: 'empty', gen: null }), 'empty'],
		[
			'a day marked empty in another zone',
			marker({ status: 'empty', gen: null, tz: 'Europe/Berlin' }),
			'probe',
		],
		[
			'a snapshot taken before the day settled',
			marker({ status: 'partial', aggregatedAt: new Date(END.getTime() + 14 * MINUTE) }),
			'aggregate',
		],
		[
			'a snapshot taken once the day settled, holding all of it',
			marker({ status: 'partial', aggregatedAt: new Date(END.getTime() + 15 * MINUTE) }),
			'aggregates',
		],
	] as const)('reads %s from its %s', (_name, found, expected) => {
		expect(source(found)).toBe(expected)
	})

	it('keeps the rows of a fixed day whatever it was counted in: the only numbers it has', () => {
		expect(source(marker({ version: 0 }), { fixed: true })).toBe('aggregates')
		expect(source(marker({ tz: 'Asia/Tokyo' }), { fixed: true })).toBe('aggregates')
		expect(source(marker({ status: 'dirty' }), { fixed: true })).toBe('aggregates')
		expect(source(marker({ status: 'empty', gen: null, tz: 'Asia/Tokyo' }), { fixed: true })).toBe(
			'empty'
		)
	})

	it('counts a day again when its window moved: the day before it is fixed in another zone', () => {
		const seam = new Date('2026-10-04T15:00:00.000Z')
		expect(source(marker(), { start: seam })).toBe('aggregate')
		expect(source(marker({ start: seam }), { start: seam })).toBe('aggregates')
		expect(source(marker({ start: seam }))).toBe('aggregate')
		expect(source(marker({ status: 'empty', gen: null }), { start: seam })).toBe('probe')
	})

	it('holds a whole day only with a generation, the current version, zone and window', () => {
		expect(holdsWholeDay(marker(), 'UTC', OWN)).toBe(true)
		expect(holdsWholeDay(marker({ gen: null }), 'UTC', OWN)).toBe(false)
		expect(holdsWholeDay(marker(), 'Europe/Berlin', OWN)).toBe(false)
		expect(holdsWholeDay(undefined, 'UTC', OWN)).toBe(false)
		expect(
			holdsWholeDay(marker(), 'UTC', { ...OWN, start: new Date(OWN.start.getTime() + 1) })
		).toBe(false)
	})
})

describe('closed days nothing aggregated', () => {
	it("predicts a day's cost from its marker only when it counted the whole day", () => {
		const window = localDay(20261005, 'UTC')
		expect(wholeDayHits(marker(), window)).toBe(120)
		expect(wholeDayHits(marker({ status: 'dirty' }), window)).toBe(120)
		expect(
			wholeDayHits(marker({ aggregatedAt: new Date('2026-10-05T18:00:00.000Z') }), window)
		).toBe(null)
		expect(wholeDayHits(marker({ status: 'open', hits: null, aggregatedAt: null }), window)).toBe(
			null
		)
		expect(wholeDayHits(undefined, window)).toBe(null)
	})

	it('groups consecutive dates into runs across month ends', () => {
		expect(runsOf([20260929, 20260930, 20261001, 20261003, 20261005, 20261006])).toEqual([
			[20260929, 20261001],
			[20261003, 20261003],
			[20261005, 20261006],
		])
		expect(runsOf([])).toEqual([])
	})
})

describe('today', () => {
	it('serves a snapshot as fresh while within the age its count gives it, an older one as stale', () => {
		const now = new Date('2026-10-06T12:00:00.000Z')
		const window = localDay(20261006, 'UTC')
		const byHits = (hits: number): number => (hits > 1000 ? 5 * MINUTE : MINUTE)
		const snap = (over: Partial<DayMarker>) =>
			snapshotState(marker({ day: 20261006, status: 'partial', ...over }), {
				tz: 'UTC',
				window,
				now,
				maxAgeMs: byHits,
			})
		expect(snap({ hits: 5000, aggregatedAt: new Date(now.getTime() - 5 * MINUTE) })).toBe('fresh')
		expect(snap({ hits: 5000, aggregatedAt: new Date(now.getTime() - 5 * MINUTE - 1) })).toBe(
			'stale'
		)
		expect(snap({ hits: 10, aggregatedAt: new Date(now.getTime() - MINUTE) })).toBe('fresh')
		expect(snap({ hits: 10, aggregatedAt: new Date(now.getTime() - MINUTE - 1) })).toBe('stale')
		expect(snap({ tz: 'Europe/Berlin', aggregatedAt: now })).toBe('none')
		expect(snap({ version: 0, aggregatedAt: now })).toBe('none')
		expect(snap({ status: 'open', gen: null })).toBe('none')
		expect(snapshotState(undefined, { tz: 'UTC', window, now, maxAgeMs: () => 1 })).toBe('none')
	})
})

describe('which rows answer a read', () => {
	it('reads the site rows unfiltered, and a breakdown from its dimension rows', () => {
		expect(readShape({ filters: [], hours: false })).toEqual({
			source: 'aggregates',
			total: { dim: '' },
		})
		expect(readShape({ filters: [], breakdown: 'country', hours: false })).toEqual({
			source: 'aggregates',
			total: { dim: '' },
			breakdown: { dim: 'country', groupBy: 'value' },
		})
	})

	it('reads a single eq filter with no breakdown from that dimension rows', () => {
		expect(readShape({ filters: [eq('source', 'google')], hours: false })).toEqual({
			source: 'aggregates',
			total: { dim: 'source', value: 'google' },
		})
		expect(readShape({ filters: [eq('item', 'offers:1')], hours: false })).toEqual({
			source: 'aggregates',
			total: { dim: 'item', value: 'offers:1' },
		})
	})

	it.each([
		'channel',
		'source',
		'utmCampaign',
	] as const)('reads a goal by %s from its pair rows', (dimension) => {
		expect(
			readShape({ filters: [eq('goal', 'purchase')], breakdown: dimension, hours: false })
		).toEqual({
			source: 'aggregates',
			total: { dim: 'goal', value: 'purchase' },
			breakdown: { dim: 'goal', value: 'purchase', dim2: dimension, groupBy: 'value2' },
		})
	})

	it('reads an item by page from its pair rows', () => {
		expect(
			readShape({ filters: [eq('item', 'offers:1')], breakdown: 'page', hours: false })
		).toEqual({
			source: 'aggregates',
			total: { dim: 'item', value: 'offers:1' },
			breakdown: { dim: 'item', value: 'offers:1', dim2: 'page', groupBy: 'value2' },
		})
	})

	it.each([
		['a breakdown with a filter', eq('country', 'DE'), 'page'],
		['a goal by device', eq('goal', 'purchase'), 'device'],
		['an item by country', eq('item', 'offers:1'), 'country'],
	] as const)('reads %s raw, its totals from the filter rows', (_name, filter, breakdown) => {
		expect(readShape({ filters: [filter], breakdown, hours: false })).toEqual({
			source: 'raw',
			total: { dim: filter.dimension, value: filter.value },
		})
	})

	it.each([
		['every series by the hour', { filters: [], hours: true }],
		[
			'a filtered series by the hour',
			{ filters: [eq('country', 'DE')], breakdown: 'page', hours: true },
		],
		[
			'a contains filter beside a breakdown',
			{
				filters: [{ dimension: 'page', operator: 'contains', value: 'blog' }],
				breakdown: 'country',
				hours: false,
			},
		],
		[
			'a contains filter',
			{ filters: [{ dimension: 'page', operator: 'contains', value: 'blog' }], hours: false },
		],
		['two filters', { filters: [eq('country', 'DE'), eq('device', 'mobile')], hours: false }],
		['an eq filter on an empty value', { filters: [eq('page', '')], hours: false }],
		['a dimension no row is kept by', { filters: [eq('medium', 'email')], hours: false }],
	] as const)('reads %s from raw hits', (_name, args) => {
		expect(readShape(args)).toEqual({ source: 'raw' })
	})
})

describe('reading a query', () => {
	it('folds the page and the item into eq filters, each filter once', () => {
		expect(
			readFilters({
				path: '/pricing',
				item: 'offers:1',
				filters: [eq('page', '/pricing'), eq('country', 'DE')],
			})
		).toEqual([eq('page', '/pricing'), eq('country', 'DE'), eq('item', 'offers:1')])
		expect(readFilters({})).toEqual([])
	})

	it('counts goal completions, items or hits by what the read names', () => {
		expect(axisOf([eq('goal', 'purchase')], 'channel')).toBe('goal')
		expect(axisOf([], 'item')).toBe('item')
		expect(axisOf([eq('item', 'offers:1')], undefined)).toBe('item')
		expect(axisOf([eq('country', 'DE')], 'page')).toBe('hit')
	})

	it('ranks items by views, goals by completions, the rest by pageviews, averages as ratios', () => {
		expect(orderOf({}, 'item')).toEqual({ part: 'impressions', dir: 'desc' })
		expect(orderOf({}, 'goal')).toEqual({ part: 'conversions', dir: 'desc' })
		expect(orderOf({}, 'hit')).toEqual({ part: 'pageviews', dir: 'desc' })
		expect(orderOf({ order: { metric: 'bounceRate', direction: 'asc' } }, 'hit')).toEqual({
			part: 'bounces',
			per: 'entries',
			dir: 'asc',
		})
		expect(orderOf({ order: { metric: 'visits', direction: 'desc' } }, 'hit')).toEqual({
			part: 'sessions',
			dir: 'desc',
		})
		expect(orderOf({ order: { metric: 'scrollDepth', direction: 'desc' } }, 'hit')).toEqual({
			part: 'scrollSum',
			per: 'scrollSamples',
			dir: 'desc',
		})
	})

	it('cuts visits only for a read that counts or ranks them', () => {
		expect(countsVisits({ metrics: ['pageviews', 'visitors'] })).toBe(false)
		expect(countsVisits({ metrics: ['bounceRate'] })).toBe(true)
		expect(
			countsVisits({
				metrics: ['pageviews'],
				order: { metric: 'visitDuration', direction: 'desc' },
			})
		).toBe(true)
	})

	it('lets a breakdown win over a series, and reads no series finer than an hour', () => {
		expect(seriesOf({ granularity: 'week' }, undefined)).toBe('week')
		expect(seriesOf({ granularity: 'day' }, 'page')).toBe(undefined)
		expect(seriesOf({ granularity: 'minute' }, undefined)).toBe(undefined)
		expect(seriesOf({}, undefined)).toBe(undefined)
	})
})

describe('the values a read of daily totals asks about', () => {
	it('names an eq filter’s value and a pair’s first value wherever a cap can fold them', () => {
		const shape = (filters: AnalyticsFilter[], breakdown?: 'channel' | 'page' | 'country') =>
			foldTargets(readShape({ filters, ...(breakdown ? { breakdown } : {}), hours: false }))
		expect(shape([eq('referrer', 'news.example')])).toEqual([
			{ dim: 'referrer', value: 'news.example' },
		])
		expect(shape([eq('page', '/a')])).toEqual([{ dim: 'page', value: '/a' }])
		expect(shape([eq('goal', 'purchase')], 'channel')).toEqual([
			{ dim: 'goal', value: 'purchase' },
			{ dim: 'goal', dim2: 'channel', value: 'purchase' },
		])
		expect(shape([eq('item', 'offers:1')], 'page')).toEqual([
			{ dim: 'item', value: 'offers:1' },
			{ dim: 'item', dim2: 'page', value: 'offers:1' },
		])
	})

	it('names none for the site row, a plain breakdown, or a read only raw hits answer', () => {
		expect(foldTargets(readShape({ filters: [], hours: false }))).toEqual([])
		expect(foldTargets(readShape({ filters: [], breakdown: 'referrer', hours: false }))).toEqual([])
		expect(foldTargets(readShape({ filters: [eq('page', '/a')], hours: true }))).toEqual([])
	})
})
