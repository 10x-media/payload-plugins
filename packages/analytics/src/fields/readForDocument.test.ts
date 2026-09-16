import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type {
	AdapterContext,
	AnalyticsAdapter,
	AnalyticsQuery,
	AnalyticsResult,
} from '../core/contract'
import { createRegistry } from '../core/registry'
import { setRuntime } from '../plugin/runtime'
import { memoryAdapter } from '../testing/memoryAdapter'
import { readForField } from './readForDocument'

const NOW = new Date('2026-06-03T12:00:00.000Z')

const recordingAdapter = (seen: AnalyticsQuery[]): AnalyticsAdapter => ({
	id: 'goals',
	label: 'Goals',
	capabilities: { ...memoryAdapter().capabilities, metrics: new Set(['conversions']) },
	isConfigured: () => true,
	async query(q: AnalyticsQuery, _ctx: AdapterContext): Promise<AnalyticsResult> {
		seen.push(q)
		return { rows: [], totals: { conversions: 0 }, meta: { provider: 'goals', fetchedAt: '' } }
	},
})

/** A request whose goals resolver fails, the way a missing collection index arrives. */
const reqWithFailingGoals = (adapter: AnalyticsAdapter): PayloadRequest => {
	const payload = { logger: { warn: () => {} } } as unknown as PayloadRequest['payload']
	setRuntime(payload, {
		registry: createRegistry([adapter]),
		configAdapterIds: new Set([adapter.id]),
		bindings: { pages: { pathField: 'slug' } },
		engine: { read: async (a, query) => a.query(query, {}) },
		ttl: { aggregate: 3600, realtime: 300 },
		comparison: false,
		resolveGoals: () => Promise.reject(new Error('boom')),
	})
	return { payload } as PayloadRequest
}

describe('readForField', () => {
	// The sentinel is what keeps a failed resolver off the healthy cache key, so every
	// read path has to hand it to the adapter rather than flattening it to an empty hint.
	it('passes the failed-resolver sentinel through to the adapter', async () => {
		const seen: AnalyticsQuery[] = []
		const result = await readForField({
			req: reqWithFailingGoals(recordingAdapter(seen)),
			collectionSlug: 'pages',
			data: { slug: '/pricing' },
			metrics: ['conversions'],
			timeframe: 'last30days',
			now: NOW,
		})
		expect(seen[0]?.goalSlugs).toBe('unresolved')
		expect(result.status).toBe('ok')
	})
})
