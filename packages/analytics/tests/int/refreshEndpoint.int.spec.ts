import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Endpoint, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../../src/core/contract'
import { analytics } from '../../src/index'
import { REFRESH_PATH } from '../../src/plugin/paths'
import { getRuntime } from '../../src/plugin/runtime'
import { createEpochStore } from '../../src/surfacing/epoch'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

type ErrorBody = { error: { code: string; message: string; param?: string } }

const scopeByEmail: Record<string, string> = {
	'a@t.dev': 'tenant-a',
	'b@t.dev': 'tenant-b',
	'platform@t.dev': 'tenant-a',
}

describeForDb('analytics refresh endpoint', {}, (db) => {
	let booted: BootedPayload
	const seen: AnalyticsQuery[] = []

	const recording: AnalyticsAdapter = {
		id: 'recording',
		label: 'Recording',
		capabilities: memoryAdapter().capabilities,
		isConfigured: () => true,
		query: async (q) => {
			seen.push(q)
			return {
				rows: [],
				totals: { pageviews: 1 },
				meta: { provider: 'recording', fetchedAt: q.dateRange.end.toISOString() },
			}
		},
	}

	// A fresh store with no memo each time, so every reading is what KV actually holds.
	const epochOf = (scope: string | null) =>
		createEpochStore(booted.payload, { memoMs: 0 }).get(scope)

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				scopeResolver: ({ req }) =>
					scopeByEmail[(req.user as { email?: string } | null)?.email ?? ''] ?? null,
				access: {
					read: ({ req }) => (req.user as { email?: string } | null)?.email !== 'noread@t.dev',
					platformRead: ({ req }) =>
						(req.user as { email?: string } | null)?.email === 'platform@t.dev',
				},
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const handler = () => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === REFRESH_PATH
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('refresh endpoint not registered')
		}
		return endpoint.handler
	}

	const call = (opts: { email?: string | null; body?: unknown } = {}): Promise<Response> => {
		const user = opts.email === null ? null : { id: 1, email: opts.email ?? 'a@t.dev' }
		return Promise.resolve(
			handler()({
				payload: booted.payload,
				user,
				url: `http://localhost/api${REFRESH_PATH}`,
				headers: new Headers(),
				...(opts.body === undefined
					? {}
					: {
							arrayBuffer: async () =>
								new TextEncoder().encode(JSON.stringify(opts.body)).buffer as ArrayBuffer,
						}),
			} as unknown as PayloadRequest)
		)
	}

	it(`registers a POST endpoint under the api route on ${db}`, () => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === REFRESH_PATH
		)
		expect(endpoint?.method).toBe('post')
	})

	it(`401s an anonymous request on ${db}`, async () => {
		const res = await call({ email: null })
		expect(res.status).toBe(401)
		expect(((await res.json()) as ErrorBody).error.code).toBe('unauthorized')
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
	})

	it(`403s a reader access denies on ${db}`, async () => {
		const res = await call({ email: 'noread@t.dev' })
		expect(res.status).toBe(403)
		expect(((await res.json()) as ErrorBody).error.code).toBe('forbidden')
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
	})

	it(`refuses a tenant naming another tenant's scope on ${db}`, async () => {
		const before = await epochOf('tenant-b')
		const res = await call({ body: { scope: 'tenant-b' } })
		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error).toMatchObject({
			code: 'untrusted_scope',
			param: 'scope',
		})
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		expect(await epochOf('tenant-b')).toBe(before)
	})

	it(`refuses a tenant asking for the platform wildcard on ${db}`, async () => {
		const res = await call({ body: { scope: '*' } })
		expect(res.status).toBe(400)
		expect(((await res.json()) as ErrorBody).error.code).toBe('untrusted_scope')
	})

	it(`bumps only the caller's own scope and answers the new epoch on ${db}`, async () => {
		const [a, b, global] = await Promise.all([
			epochOf('tenant-a'),
			epochOf('tenant-b'),
			epochOf(null),
		])
		const res = await call()
		expect(res.status).toBe(200)
		expect(res.headers.get('Cache-Control')).toBe('private, no-store')
		expect((await res.json()) as { epoch: number }).toEqual({ epoch: a + 1 })
		expect(await epochOf('tenant-a')).toBe(a + 1)
		expect(await epochOf('tenant-b')).toBe(b)
		expect(await epochOf(null)).toBe(global)
	})

	it(`accepts a request with no body at all on ${db}`, async () => {
		const before = await epochOf('tenant-b')
		const res = await call({ email: 'b@t.dev' })
		expect(res.status).toBe(200)
		expect(await epochOf('tenant-b')).toBe(before + 1)
	})

	it(`lets a platform reader name another scope on ${db}`, async () => {
		const before = await epochOf('tenant-b')
		const res = await call({ email: 'platform@t.dev', body: { scope: 'tenant-b' } })
		expect(res.status).toBe(200)
		expect((await res.json()) as { epoch: number }).toEqual({ epoch: before + 1 })
		expect(await epochOf('tenant-b')).toBe(before + 1)
	})

	// The wildcard is what a cross-scope read resolves to, and a cross-scope read stamps no
	// scope on its query, so the install-wide counter is the one its entries key on.
	it(`bumps the install-wide counter for the platform wildcard on ${db}`, async () => {
		const before = await epochOf(null)
		const res = await call({ email: 'platform@t.dev', body: { scope: '*' } })
		expect(res.status).toBe(200)
		expect(await epochOf(null)).toBe(before + 1)
	})

	it(`sends the next read of the refreshed scope back to the adapter on ${db}`, async () => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) throw new Error('runtime missing')
		const query: AnalyticsQuery = {
			metrics: ['pageviews'],
			dateRange: { start: new Date('2026-02-01'), end: new Date('2026-02-28') },
			scope: 'tenant-a',
		}
		seen.length = 0
		await runtime.engine.read(recording, query)
		await runtime.engine.read(recording, query)
		expect(seen.length).toBe(1)

		expect((await call()).status).toBe(200)
		await runtime.engine.read(recording, query)
		expect(seen.length).toBe(2)
	})
})
