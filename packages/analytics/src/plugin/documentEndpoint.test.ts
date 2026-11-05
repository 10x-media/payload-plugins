import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { allCrossScope } from '../core/options'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import { makeDocumentHandler } from './documentEndpoint'
import { type AnalyticsRuntime, setRuntime } from './runtime'

type ErrorBody = { error: { code: string } }

const recording = (seen: AnalyticsQuery[]): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		id: 'native',
		capabilities: { ...base.capabilities, scopedQueries: true },
		isConfigured: () => true,
		async query(query: AnalyticsQuery): Promise<AnalyticsResult> {
			seen.push(query)
			return { rows: [], totals: { pageviews: 1 }, meta: { provider: 'native', fetchedAt: '' } }
		},
	}
}

/**
 * One page of tenant alpha, whose `note` field the author filled with another tenant's id: the
 * attack is to have the endpoint read the scope out of that field instead of `tenant`.
 */
const DOC = { id: 'p1', slug: '/home', tenant: 'alpha', note: 'beta' }

const reqFor = (args: {
	seen: AnalyticsQuery[]
	url: string
	named?: boolean
	member?: boolean
	doc?: Record<string, unknown>
}): PayloadRequest => {
	const payload = {
		logger: { warn: vi.fn(), error: vi.fn() },
		findByID: async () => args.doc ?? DOC,
	} as unknown as Payload
	const runtime: AnalyticsRuntime = {
		registry: createRegistry([recording(args.seen)]),
		configAdapterIds: new Set(['native']),
		bindings: { pages: { pathField: 'slug', scopeField: 'tenant' } },
		readAccess: () => true,
		engine: { read: async (adapter, query) => adapter.query(query, {}) },
		ttl: {},
		comparison: false,
		scoped: true,
		resolveScope: async () => 'alpha',
		member: () => args.member ?? true,
		crossScope: allCrossScope(() => args.named ?? false),
	}
	setRuntime(payload, runtime)
	return { user: { id: 1 }, payload, url: args.url } as unknown as PayloadRequest
}

const base = '/api/_x/document?collection=pages&id=p1&metrics=pageviews'

describe('makeDocumentHandler document scope', () => {
	// The attack this closes: any text field of a document the reader owns could name another
	// tenant, and a parameter in the query string chose which field the scope came out of.
	it('ignores a scope field named in the query string and reads the binding', async () => {
		const seen: AnalyticsQuery[] = []
		const url = `${base}&scopeFrom=note&scopeField=note`
		const res = await makeDocumentHandler()(reqFor({ seen, url }))

		expect(res.status).toBe(200)
		expect(seen[0]?.scope).toBe('alpha')
	})

	it('refuses a document belonging to a tenant the reader may not name', async () => {
		const seen: AnalyticsQuery[] = []
		const res = await makeDocumentHandler()(
			reqFor({ seen, url: base, doc: { ...DOC, tenant: 'beta' } })
		)

		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error.code).toBe('untrusted_scope')
		expect(seen).toEqual([])
	})

	it('serves the same document to platform staff, in its own scope', async () => {
		const seen: AnalyticsQuery[] = []
		const res = await makeDocumentHandler()(
			reqFor({ seen, url: base, named: true, doc: { ...DOC, tenant: 'beta' } })
		)

		expect(res.status).toBe(200)
		expect(seen[0]?.scope).toBe('beta')
	})

	// The panel sends no `limit`: `Number(null)` read as 0 and clamped every list to one row.
	it('reads five rows per list when the request names no limit', async () => {
		const seen: AnalyticsQuery[] = []
		const res = await makeDocumentHandler()(
			reqFor({ seen, url: `${base}&dimensions=country,device` })
		)

		expect(res.status).toBe(200)
		const lists = seen.filter((query) => (query.dimensions ?? []).length > 0)
		expect(lists.map((query) => query.limit)).toEqual([5, 5])
	})

	it('keeps a limit it was given, within the panel bound', async () => {
		const seen: AnalyticsQuery[] = []
		await makeDocumentHandler()(reqFor({ seen, url: `${base}&dimensions=country&limit=12` }))
		await makeDocumentHandler()(reqFor({ seen, url: `${base}&dimensions=country&limit=0` }))
		await makeDocumentHandler()(reqFor({ seen, url: `${base}&dimensions=country&limit=` }))

		const lists = seen.filter((query) => (query.dimensions ?? []).length > 0)
		expect(lists.map((query) => query.limit)).toEqual([12, 1, 5])
	})

	// Selecting alpha is not belonging to it: the page is alpha's, and so is the selector.
	it('refuses a document of the selected tenant to a user who does not belong to it', async () => {
		const seen: AnalyticsQuery[] = []
		const res = await makeDocumentHandler()(reqFor({ seen, url: base, member: false }))

		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error.code).toBe('untrusted_scope')
		expect(seen).toEqual([])
	})
})
