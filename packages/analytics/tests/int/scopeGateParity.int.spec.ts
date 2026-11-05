import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsCapabilities } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { createEpochStore } from '../../src/surfacing/epoch'
import { handlerAt } from './endpointHelpers'

// Query and refresh endpoints share `resolveRequestedScope`, so each refuses what the other does.
// A refused refresh must bump no token, or any reader could retire the install-wide cache.

const routes = routePaths(DEFAULT_ROUTE_BASE)

const RANGE = 'from=2026-01-10&to=2026-01-16'

const capabilities: AnalyticsCapabilities = {
	realtime: false,
	minGranularity: 'day',
	maxLookbackDays: null,
	metrics: new Set(['pageviews']),
	dimensions: new Set(['page']),
	filters: { page: ['eq'] },
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
	'stranger@t.dev': 'tenant-b',
}

/** The one reader whose selection names a tenant they do not belong to. */
const STRANGER = 'stranger@t.dev'

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
	const res = await handlerAt(
		booted.payload,
		routes.query
	)({
		payload: booted.payload,
		user: { id: 1, email: probe.email, collection: 'users' },
		url: `http://localhost/api${routes.query}?${search.toString()}`,
		headers: new Headers(),
	} as unknown as PayloadRequest)
	return res.status === 200 ? 'allowed' : 'refused'
}

const refreshVerdict = async (booted: BootedPayload, probe: Probe): Promise<Verdict> => {
	const body = probe.scope === undefined ? {} : { scope: probe.scope }
	const res = await handlerAt(
		booted.payload,
		routes.refresh
	)({
		payload: booted.payload,
		user: { id: 1, email: probe.email, collection: 'users' },
		url: `http://localhost/api${routes.refresh}`,
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
				scope: {
					member: ({ req }) => (req.user as { email?: string } | null)?.email !== STRANGER,
					resolve: ({ req }) =>
						scopeByEmail[(req.user as { email?: string } | null)?.email ?? ''] ?? null,
				},
				access: {
					crossScope: ({ req }) =>
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
		// The widget links carry the scope their read resolved to, so a tenant admin following
		// one names their own tenant back at the endpoint and has to land on the view.
		{
			name: 'own scope named explicitly, tenant',
			probe: { email: 'a@t.dev', scope: 'tenant-a' },
			expected: 'allowed',
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
		{
			name: 'a selected tenant the reader does not belong to',
			probe: { email: STRANGER },
			expected: 'refused',
		},
		{
			name: 'that tenant named explicitly',
			probe: { email: STRANGER, scope: 'tenant-b' },
			expected: 'refused',
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
