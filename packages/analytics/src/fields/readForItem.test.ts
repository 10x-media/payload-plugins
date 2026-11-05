import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { readForField } from './readForDocument'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const base = memoryAdapter().capabilities

/** A source that reads items, answering every read with a row and recording what it was asked. */
const itemAdapter = (
	seen: AnalyticsQuery[],
	over: Partial<AnalyticsAdapter['capabilities']> = {}
): AnalyticsAdapter => ({
	id: 'native',
	label: 'Native',
	capabilities: {
		...base,
		realtime: true,
		perItemQuery: true,
		metrics: new Set([
			'pageviews',
			'visitors',
			'events',
			'impressions',
			'interactions',
			'conversions',
			'revenue',
		]),
		dimensions: new Set(['page', 'country', 'device', 'item']),
		filters: { page: ['eq'], item: ['eq'] },
		...over,
	},
	isConfigured: () => true,
	async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
		seen.push(q)
		const dimension = q.dimensions?.[0]
		return {
			rows: dimension
				? [{ dimensions: { [dimension]: '/pricing' }, metrics: { impressions: 4 } }]
				: [],
			totals: { impressions: 12, interactions: 3, visitors: 9 },
			meta: { provider: 'native', fetchedAt: '' },
		}
	},
})

const reqWith = (adapters: AnalyticsAdapter[]): PayloadRequest => {
	const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry(adapters),
		configAdapterIds: new Set(adapters.map((adapter) => adapter.id)),
		bindings: {
			offers: { item: true, scopeField: false },
			pages: { pathField: 'slug', scopeField: false },
		},
		readAccess: () => true,
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: false,
	})
	return { payload } as PayloadRequest
}

const readItem = (adapters: AnalyticsAdapter[], over: Record<string, unknown> = {}) =>
	readForField({
		req: reqWith(adapters),
		collectionSlug: 'offers',
		data: { id: '7', title: 'Spring sale' },
		metrics: ['impressions', 'visitors', 'interactions', 'pageviews'],
		timeframe: 'last30days',
		now: NOW,
		report: 'item',
		...over,
	})

describe('readForField item report', () => {
	it("reads the document under its ref, wherever it was shown, dropping a page's metrics", async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readItem([itemAdapter(seen)])
		expect(result.status).toBe('ok')
		expect(result.report).toBe('item')
		expect(result.supportedMetrics).toEqual(['impressions', 'visitors', 'interactions'])
		expect(result.droppedMetrics).toEqual(['pageviews'])
		expect(seen[0]?.item).toBe('offers:7')
		expect(seen[0]?.path).toBeUndefined()
		expect(result.metrics).toEqual({ impressions: 12, interactions: 3, visitors: 9 })
	})

	it('draws no live counter: nothing about an item is counted live', async () => {
		const result = await readItem([itemAdapter([])])
		expect(result.realtime).toBeUndefined()
	})

	it('reads its views per day for the trend', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readItem([itemAdapter(seen)], { series: true })
		const series = seen.find((query) => query.granularity === 'day')
		expect(series?.metrics).toEqual(['impressions'])
		expect(result.seriesGranularity).toBe('day')
	})

	// An `item eq` filter also matches the item's views, so its visitors alone are everyone who
	// saw it: the people who clicked are the ones with a click besides.
	it('ranks where it was seen from its own buckets, and the people who clicked by their clicks', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readItem(
			[itemAdapter(seen, { filters: { page: ['eq'], item: ['eq'], event: ['eq'] } })],
			{ dimensions: ['page', 'country', 'device'] }
		)
		const pages = seen.find((query) => query.dimensions?.[0] === 'page')
		const countries = seen.find((query) => query.dimensions?.[0] === 'country')
		expect(pages).toMatchObject({ item: 'offers:7', metrics: ['impressions'] })
		expect(pages?.filters).toBeUndefined()
		expect(countries).toMatchObject({
			metrics: ['visitors'],
			filters: [
				{ dimension: 'item', operator: 'eq', value: 'offers:7' },
				{ dimension: 'event', operator: 'eq', value: 'item_click' },
			],
		})
		expect(countries?.item).toBeUndefined()
		expect(result.breakdowns?.map((block) => [block.dimension, block.metric])).toEqual([
			['page', 'impressions'],
			['country', 'visitors'],
			['device', 'visitors'],
		])
	})

	it('ranks clicks rather than people where the source cannot single out a click', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readItem([itemAdapter(seen)], { dimensions: ['country'] })
		expect(seen.find((query) => query.dimensions?.[0] === 'country')).toMatchObject({
			metrics: ['interactions'],
			filters: [{ dimension: 'item', operator: 'eq', value: 'offers:7' }],
		})
		expect(result.breakdowns?.map((block) => block.metric)).toEqual(['interactions'])
	})

	it('leaves out a list the source cannot narrow to the item', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readItem([itemAdapter(seen, { filters: { page: ['eq'] } })], {
			dimensions: ['page', 'country', 'browser'],
		})
		expect(result.breakdowns?.map((block) => block.dimension)).toEqual(['page'])
		expect(result.incomplete).toBeUndefined()
	})

	it('says a collection not bound as items is not set up for it', async () => {
		const result = await readItem([itemAdapter([])], {
			collectionSlug: 'pages',
			data: { id: '1', slug: '/a' },
		})
		expect(result.status).toBe('not-bound')
	})

	it('reads an unsaved document as new', async () => {
		const result = await readItem([itemAdapter([])], { data: { title: 'Draft' } })
		expect(result.status).toBe('no-path')
	})

	it('is unavailable through a source that cannot read one item', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readItem([itemAdapter(seen, { perItemQuery: undefined })])
		expect(result.status).toBe('unavailable')
		expect(seen).toEqual([])
	})

	it("goes through a source that can read items when the scope's default cannot", async () => {
		const plain = { ...itemAdapter([], { perItemQuery: undefined }), id: 'memory' }
		const result = await readItem([plain, itemAdapter([])])
		expect(result.adapterId).toBe('native')
		expect(result.status).toBe('ok')
	})

	it('still reads the page report as before for the same collection asked for its page', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readForField({
			req: reqWith([itemAdapter(seen)]),
			collectionSlug: 'pages',
			data: { id: '1', slug: '/a' },
			metrics: ['pageviews'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(result.report).toBeUndefined()
		expect(seen[0]?.path).toBe('/a')
		expect(seen[0]?.item).toBeUndefined()
	})
})
