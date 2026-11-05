import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq, type Endpoint, type PayloadRequest, type TypedUser } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { type AnalyticsRuntime, getRuntime } from '../../src/plugin/runtime'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import type { QueryResponse } from '../../src/query/response'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { advancePayloadClock, resetPayloadClock } from './payloadClock'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const RANGE = 'from=2026-01-10&to=2026-01-16'

type ErrorBody = { error: { code: string; message: string; param?: string } }

/**
 * Plausible query API on loopback: `slow.example` holds every request until released,
 * `fast.example` answers at once with what the test set, the rest fail the way a vendor does.
 */
const startPlausible = async () => {
	const held: ServerResponse[] = []
	const values = { fast: 1 }
	const asked: string[] = []
	const reply = (res: ServerResponse, pageviews: number): void => {
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(JSON.stringify({ results: [{ metrics: [pageviews], dimensions: [] }] }))
	}
	const server = createServer((req, res) => {
		let body = ''
		req.on('data', (chunk: Buffer) => {
			body += chunk.toString()
		})
		req.on('end', () => {
			const siteId = String((JSON.parse(body) as { site_id?: unknown }).site_id)
			asked.push(siteId)
			if (siteId === 'slow.example') {
				held.push(res)
				return
			}
			if (siteId === 'denied.example') {
				res.writeHead(401, { 'content-type': 'text/plain' })
				res.end('invalid api key')
				return
			}
			if (siteId === 'refused.example') {
				res.writeHead(400, { 'content-type': 'text/plain' })
				res.end('invalid filter')
				return
			}
			if (siteId === 'busy.example') {
				res.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '7' })
				res.end('maintenance')
				return
			}
			reply(res, values.fast)
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	return {
		origin: `http://127.0.0.1:${port}`,
		values,
		asked,
		releaseSlow: () => {
			for (const res of held.splice(0)) {
				reply(res, 9)
			}
		},
		heldCount: () => held.length,
		stop: () =>
			new Promise<void>((resolve) => {
				for (const res of held.splice(0)) {
					res.destroy()
				}
				server.close(() => resolve())
			}),
	}
}

describeForDb('analytics lanes: tenants, budgets, stale serving and failures', {}, (db) => {
	let booted: BootedPayload
	let vendor: Awaited<ReturnType<typeof startPlausible>>
	const sources = new Map<string, string>()

	beforeAll(async () => {
		vendor = await startPlausible()
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: () => true },
				providers: {
					collection: true,
					hosts: { allow: [vendor.origin], allowPrivateNetwork: true },
				},
				cache: { ttl: { aggregate: 1 }, timeoutMs: 3000, concurrency: { perScope: 2 } },
				widgets: { comparison: false },
			}),
		})
		for (const [tenant, siteId] of [
			['slow', 'slow.example'],
			['fast', 'fast.example'],
			['denied', 'denied.example'],
			['refused', 'refused.example'],
			['busy', 'busy.example'],
		] as const) {
			const doc = await booted.payload.create({
				collection: PROVIDERS_SLUG,
				data: {
					name: `${tenant} Plausible`,
					provider: 'plausible',
					enabled: true,
					scope: tenant,
					plausible: { siteId, apiKey: 'plausible-key', host: vendor.origin },
				},
				overrideAccess: true,
			})
			sources.set(tenant, `plausible:${doc.id}`)
		}
	}, 240_000)

	afterAll(async () => {
		resetPayloadClock()
		vendor?.releaseSlow()
		await booted?.stop()
		await vendor?.stop()
	})

	const runtime = (): AnalyticsRuntime => {
		const found = getRuntime(booted.payload)
		if (!found) throw new Error('runtime missing')
		return found
	}

	/** The query endpoint, asked by a signed-in admin with `tenant` selected. */
	const query = async (tenant: string, path: string): Promise<Response> => {
		const endpoint = (booted.payload.config.endpoints ?? []).find(
			(e): e is Endpoint => typeof e === 'object' && e.path === routes.query
		)
		if (!endpoint || typeof endpoint.handler !== 'function') {
			throw new Error('query endpoint not registered')
		}
		const req: PayloadRequest = await createLocalReq(
			{
				req: {
					url: `http://localhost/api${routes.query}?source=${sources.get(tenant)}&metrics=pageviews&path=${encodeURIComponent(path)}&${RANGE}`,
					headers: new Headers({ 'x-tenant': tenant }),
				},
				user: {
					id: 'reader',
					collection: booted.payload.config.admin.user,
				} as unknown as TypedUser,
			},
			booted.payload
		)
		return endpoint.handler(req)
	}

	const pageviewsOf = async (res: Response): Promise<number | null | undefined> =>
		((await res.json()) as QueryResponse).result.totals?.pageviews

	it(`keeps a slow tenant from starving another, and refuses its cold reads past the budget with 429 on ${db}`, async () => {
		const first = query('slow', '/a')
		const second = query('slow', '/b')
		await expect.poll(() => vendor.heldCount(), { timeout: 5000 }).toBe(2)

		const refused = await query('slow', '/c')
		expect(refused.status).toBe(429)
		expect(refused.headers.get('Retry-After')).toBe('2')
		expect(((await refused.json()) as ErrorBody).error.code).toBe('rate_limited')

		// Another tenant's source has its own lane and its own budget: it answers at once.
		const other = await query('fast', '/a')
		expect(other.status).toBe(200)
		expect(await pageviewsOf(other)).toBe(1)

		vendor.releaseSlow()
		expect((await first).status).toBe(200)
		expect(await pageviewsOf(await second)).toBe(9)
	})

	it(`answers an expired entry at once and refreshes it behind the answer on ${db}`, async () => {
		vendor.values.fast = 1
		expect(await pageviewsOf(await query('fast', '/stale'))).toBe(1)
		vendor.values.fast = 2
		// Past the one-second TTL and this instance's memo of it.
		await advancePayloadClock(booted.payload, 1_200)

		const stale = (await (await query('fast', '/stale')).json()) as QueryResponse
		expect(stale.result.meta.stale).toBe(true)
		expect(stale.result.totals?.pageviews).toBe(1)

		await runtime().engine.idle?.()
		const fresh = (await (await query('fast', '/stale')).json()) as QueryResponse
		expect(fresh.result.meta.stale).toBeUndefined()
		expect(fresh.result.totals?.pageviews).toBe(2)
	})

	it(`answers a refused key 502, then rests the source and keeps saying so at once on ${db}`, async () => {
		const denied = await query('denied', '/a')
		expect(denied.status).toBe(502)
		expect(denied.headers.get('Retry-After')).toBeNull()
		expect(((await denied.json()) as ErrorBody).error).toMatchObject({
			code: 'source_misconfigured',
			param: 'source',
		})
		const before = vendor.asked.filter((site) => site === 'denied.example').length
		const resting = await query('denied', '/b')
		expect(resting.status).toBe(502)
		expect(((await resting.json()) as ErrorBody).error.code).toBe('source_misconfigured')
		expect(vendor.asked.filter((site) => site === 'denied.example')).toHaveLength(before)
	})

	it(`answers a query the vendor refuses 400 without retrying it on ${db}`, async () => {
		const before = vendor.asked.filter((site) => site === 'refused.example').length
		const refused = await query('refused', '/a')
		expect(refused.status).toBe(400)
		expect(((await refused.json()) as ErrorBody).error).toMatchObject({
			code: 'invalid_param',
			param: 'query',
		})
		expect(vendor.asked.filter((site) => site === 'refused.example')).toHaveLength(before + 1)
	})

	it(`passes on a vendor's Retry-After that outlasts the read, without asking again on ${db}`, async () => {
		const busy = await query('busy', '/a')
		expect(busy.status).toBe(503)
		const wait = Number(busy.headers.get('Retry-After'))
		expect(wait).toBeGreaterThanOrEqual(6)
		expect(wait).toBeLessThanOrEqual(7)
		expect(((await busy.json()) as ErrorBody).error.code).toBe('unavailable')
		// The first answer paused the lane for seven seconds, past the read's three: no retry went out.
		expect(vendor.asked.filter((site) => site === 'busy.example')).toHaveLength(1)
	})
})
