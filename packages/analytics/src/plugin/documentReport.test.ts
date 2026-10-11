import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import { makeDocumentHandler } from './documentEndpoint'
import { setRuntime } from './runtime'

const native = (seen: AnalyticsQuery[]): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		id: 'native',
		capabilities: {
			...base.capabilities,
			perItemQuery: true,
			metrics: new Set(['pageviews', 'visitors', 'impressions', 'interactions', 'conversions']),
			dimensions: new Set(['page', 'country', 'device', 'item']),
			filters: { page: ['eq'], item: ['eq'] },
		},
		isConfigured: () => true,
		async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
			seen.push(query)
			return { rows: [], totals: { impressions: 3 }, meta: { provider: 'native', fetchedAt: '' } }
		},
	}
}

/** One document of a collection bound as both a page and an item. */
const call = async (query: string) => {
	const seen: AnalyticsQuery[] = []
	const payload = {
		logger: { warn: vi.fn(), error: vi.fn() },
		findByID: async () => ({ id: 'o7', slug: '/spring' }),
	} as unknown as Payload
	setRuntime(payload, {
		registry: createRegistry([native(seen)]),
		configAdapterIds: new Set(['native']),
		bindings: {
			offers: { pathField: 'slug', item: true, scopeField: false },
			pages: { pathField: 'slug', scopeField: false },
		},
		readAccess: () => true,
		engine: { read: async (adapter, read) => adapter.query(read, {}) },
		ttl: {},
		comparison: false,
	})
	const res = await makeDocumentHandler()({
		user: { id: 1 },
		payload,
		url: `/api/_x/document?${query}`,
	} as unknown as PayloadRequest)
	return { res, seen, body: (await res.json()) as { report?: string; supportedMetrics: string[] } }
}

describe('makeDocumentHandler reports', () => {
	it("opens a collection bound as both on the item, with the item's own metrics", async () => {
		const { res, seen, body } = await call('collection=offers&id=o7')
		expect(res.status).toBe(200)
		expect(body.report).toBe('item')
		expect(body.supportedMetrics).toEqual([
			'impressions',
			'visitors',
			'interactions',
			'conversions',
		])
		expect(seen[0]?.item).toBe('offers:o7')
	})

	it('reads the page when asked for it', async () => {
		const { body, seen } = await call('collection=offers&id=o7&report=page&metrics=pageviews')
		expect(body.report).toBeUndefined()
		expect(seen[0]?.path).toBe('/spring')
		expect(seen[0]?.item).toBeUndefined()
	})

	it('reads a page-bound collection as before when no report is named', async () => {
		const { body, seen } = await call('collection=pages&id=o7&metrics=pageviews')
		expect(body.report).toBeUndefined()
		expect(seen[0]?.path).toBe('/spring')
	})
})
