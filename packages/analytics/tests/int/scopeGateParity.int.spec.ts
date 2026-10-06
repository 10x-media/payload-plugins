import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsCapabilities } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { QUERY_PATH, REFRESH_PATH } from '../../src/plugin/paths'
import { createEpochStore } from '../../src/surfacing/epoch'

/**
 * The query endpoint and the refresh endpoint decide scope through one helper
 * (`resolveRequestedScope`), so every request either endpoint refuses is refused by the
 * other. A refresh that refuses must also leave every token exactly as it found it: the
 * install-wide one is what cross-scope reads key on, so bumping it for a request that
 * resolved nothing would let any authenticated reader retire the platform's cache.
 */
const RANGE = 'from=2026-01-10&to=2026-01-16'

const capabilities: AnalyticsCapabilities = {
	perPageQuery: true,
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(['page']),
	filters: new Set(['page']),
	filterOperators: new Set(['eq']),
	batchPageReport: false,
	rateLimit: null,
	recommendedTtl: { realtime: 60, aggregate: 3600 },
	scopedQueries: true,
}

const stub = (id: string): AnalyticsAdapter => ({
	id,
	label: id,
	capabilities,
	isConfigured: () => true,
	query: async (q) => ({
		rows: [],
		totals: { pageviews: 1 },
		meta: { provider: id, fetchedAt: q.dateRange.end.toISOString() },
	}),
})

type Verdict = 'allowed' | 'refused'

const scopeByEmail: Record<string, string> = {
	'a@t.dev': 'tenant-a',
	'b@t.dev': 'tenant-b',
	'platform@t.dev': 'tenant-a',
}

const handlerFor = (booted: BootedPayload, path: string) => {
	const endpoint = (booted.payload.config.endpoints ?? []).find(
		(e): e is Endpoint => typeof e === 'object' && e.path === path
	)
	if (!endpoint || typeof endpoint.handler !== 'function') {
		throw new Error(`endpoint ${path} not registered`)
	}
	return endpoint.handler
}

interface Probe {
	/** What the caller sent as `scope`; undefined is a request that named none at all. */
	scope?: string
	email: string
}

const queryVerdict = async (booted: BootedPayload, probe: Probe): Promise<Verdict> => {
	const search = new URLSearchParams(`metrics=pageviews&${RANGE}`)
	if (probe.scope !== undefined) {
		search.set('scope', probe.scope)
	}
	const res = await handlerFor(
		booted,
		QUERY_PATH
	)({
		payload: booted.payload,
		user: { id: 1, email: probe.email },
		url: `http://localhost/api${QUERY_PATH}?${search.toString()}`,
		headers: new Headers(),
	} as unknown as PayloadRequest)
	return res.status === 200 ? 'allowed' : 'refused'
}

const refreshVerdict = async (booted: BootedPayload, probe: Probe): Promise<Verdict> => {
	const body = probe.scope === undefined ? {} : { scope: probe.scope }
	const res = await handlerFor(
		booted,
		REFRESH_PATH
	)({
		payload: booted.payload,
		user: { id: 1, email: probe.email },
		url: `http://localhost/api${REFRESH_PATH}`,
		headers: new Headers(),
		arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer,
	} as unknown as PayloadRequest)
	return res.status === 200 ? 'allowed' : 'refused'
}

describeForDb('analytics scope gate parity - scoped install', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [stub('tenanted')],
				scopeResolver: ({ req }) =>
					scopeByEmail[(req.user as { email?: string } | null)?.email ?? ''] ?? null,
				access: {
					platformRead: ({ req }) =>
						((req.user as { email?: string } | null)?.email ?? '').startsWith('platform'),
				},
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	// A fresh store with no memo, so every reading is what KV actually holds.
	const tokens = async (): Promise<string[]> => {
		const store = createEpochStore(booted.payload, { memoMs: 0 })
		return Promise.all([null, 'tenant-a', 'tenant-b'].map((scope) => store.get(scope)))
	}

	const cases: { name: string; probe: Probe; expected: Verdict }[] = [
		{ name: 'scope omitted, tenant', probe: { email: 'a@t.dev' }, expected: 'allowed' },
		{ name: 'scope empty, tenant', probe: { email: 'a@t.dev', scope: '' }, expected: 'allowed' },
		{
			name: 'scope padded, platform reader',
			probe: { email: 'platform@t.dev', scope: '  tenant-a  ' },
			expected: 'allowed',
		},
		{
			name: 'platform wildcard, tenant',
			probe: { email: 'a@t.dev', scope: '*' },
			expected: 'refused',
		},
		{
			name: 'platform wildcard, platform reader',
			probe: { email: 'platform@t.dev', scope: '*' },
			expected: 'allowed',
		},
		{
			name: "another tenant's scope, tenant",
			probe: { email: 'a@t.dev', scope: 'tenant-b' },
			expected: 'refused',
		},
		{
			name: 'own scope named explicitly, tenant',
			probe: { email: 'a@t.dev', scope: 'tenant-a' },
			expected: 'refused',
		},
		{
			name: 'no scope resolves, tenant',
			probe: { email: 'nobody@t.dev' },
			expected: 'refused',
		},
		{
			name: 'no scope resolves, platform reader',
			probe: { email: 'platform-none@t.dev' },
			expected: 'allowed',
		},
	]

	for (const { name, probe, expected } of cases) {
		it(`agrees on ${name} (${expected}) on ${db}`, async () => {
			const before = await tokens()
			const query = await queryVerdict(booted, probe)
			const refresh = await refreshVerdict(booted, probe)

			expect(query).toBe(expected)
			expect(refresh).toBe(query)
			if (expected === 'refused') {
				expect(await tokens()).toEqual(before)
			}
		})
	}
})

describeForDb('analytics scope gate parity - unscoped install', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({ adapters: [stub('only')] }),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it(`lets a platform reader through on both endpoints on ${db}`, async () => {
		const probe: Probe = { email: 'platform@t.dev' }
		const query = await queryVerdict(booted, probe)
		expect(query).toBe('allowed')
		expect(await refreshVerdict(booted, probe)).toBe(query)
	})
})
