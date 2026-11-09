import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { createLocalReq, type TypedUser } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import type { ProviderStatusResponse } from '../../src/providers/connectionState'
import { PROVIDER_STATUS_SLUG } from '../../src/providers/status'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { callEndpoint, handlerAt } from './endpointHelpers'

const routes = routePaths(DEFAULT_ROUTE_BASE)

type ErrorBody = { error: { code: string; param?: string } }

/** Which tenant each test user belongs to; `alpha-viewer` reads alpha's documents but edits none. */
const TENANT: Record<string, string> = { alpha: 'alpha', 'alpha-viewer': 'alpha', beta: 'beta' }

const userOf = (id: string): TypedUser => ({ id, collection: 'users' }) as unknown as TypedUser

/** Plausible's query API on loopback: `denied.example` is refused the way a wrong key is. */
const startPlausible = async () => {
	const asked: string[] = []
	const server = createServer((req, res) => {
		let body = ''
		req.on('data', (chunk: Buffer) => {
			body += chunk.toString()
		})
		req.on('end', () => {
			const siteId = String((JSON.parse(body) as { site_id?: unknown }).site_id)
			asked.push(siteId)
			if (siteId.startsWith('denied')) {
				res.writeHead(401, { 'content-type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid API key or site ID' }))
				return
			}
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ results: [{ metrics: [3], dimensions: [] }] }))
		})
	})
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	return {
		origin: `http://127.0.0.1:${port}`,
		asked,
		stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
	}
}

describeForDb('analytics provider status: reads, the Test connection button, tenants', {}, (db) => {
	let booted: BootedPayload
	let vendor: Awaited<ReturnType<typeof startPlausible>>

	beforeAll(async () => {
		vendor = await startPlausible()
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				capture: { gate: 'off' },
				scope: {
					resolve: ({ req }) => TENANT[String(req.user?.id)] ?? null,
					member: ({ req, scope }) => TENANT[String(req.user?.id)] === scope,
				},
				access: { crossScope: () => false },
				providers: {
					collection: {
						access: {
							update: ({ req }) =>
								req.user?.id === 'alpha' || req.user?.id === 'beta'
									? { scope: { equals: TENANT[String(req.user.id)] } }
									: false,
						},
					},
					hosts: { allow: [vendor.origin], allowPrivateNetwork: true },
				},
				widgets: { comparison: false },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
		await vendor?.stop()
	})

	const createProvider = async (scope: string, siteId: string) =>
		booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: {
				name: `${siteId} Plausible`,
				provider: 'plausible',
				enabled: true,
				scope,
				plausible: { siteId, apiKey: 'plausible-key', host: vendor.origin },
			},
			// Stamped into the creator's own tenant, which the scope it names must be.
			user: userOf(scope),
			overrideAccess: true,
		})

	/** The status endpoint, called by `who` the way Payload's router hands the request over. */
	const status = async (method: 'GET' | 'POST', who: string | null, id: unknown) => {
		const query = id === undefined ? '' : `?id=${encodeURIComponent(String(id))}`
		const req = await createLocalReq(
			{
				req: { url: `http://localhost/api${routes.providerStatus}${query}`, method },
				...(who ? { user: userOf(who) } : {}),
			},
			booted.payload
		)
		return handlerAt(booted.payload, routes.providerStatus)(req)
	}

	const rowsOf = async (id: unknown) =>
		(
			await booted.payload.db.find<{ id: unknown; errorKind?: string; pausedUntil?: unknown }>({
				collection: PROVIDER_STATUS_SLUG,
				where: { id: { equals: String(id) } },
				limit: 0,
				pagination: false,
			})
		).docs

	it(`checks a new document's connection and keys its row by the document's own id on ${db}`, async () => {
		const doc = await createProvider('alpha', 'works.example')
		const res = await status('POST', 'alpha', doc.id)
		expect(res.status).toBe(200)
		const body = (await res.json()) as ProviderStatusResponse
		expect(body.checked).toEqual({ ok: true })
		expect(body.status.lastSuccessAt).toEqual(expect.any(String))
		expect(vendor.asked).toContain('works.example')

		const rows = await rowsOf(doc.id)
		expect(rows).toHaveLength(1)
		expect(String(rows[0]?.id)).toBe(String(doc.id))
		// A Postgres document is numbered, a Mongo one an ObjectId: the row's text id is either.
		expect(String(doc.id)).toMatch(db === 'mongo' ? /^[0-9a-f]{24}$/ : /^\d+$/)

		const read = await status('GET', 'alpha-viewer', doc.id)
		expect(read.status).toBe(200)
		expect(((await read.json()) as ProviderStatusResponse).status).toEqual(body.status)
	})

	it(`answers a refused key with the vendor's own words, and keeps them on ${db}`, async () => {
		const doc = await createProvider('alpha', 'denied-check.example')
		const body = (await (await status('POST', 'alpha', doc.id)).json()) as ProviderStatusResponse
		expect(body.checked).toMatchObject({ ok: false, kind: 'source_misconfigured' })
		expect(body.checked && !body.checked.ok && body.checked.detail).toContain(
			'Invalid API key or site ID'
		)
		expect(body.status).toMatchObject({
			errorKind: 'source_misconfigured',
			errorDetail: expect.stringContaining('HTTP 401'),
			lastErrorAt: expect.any(String),
		})
	})

	it(`records what an ordinary read found, the pause included, on ${db}`, async () => {
		const doc = await createProvider('alpha', 'denied-read.example')
		const res = await callEndpoint(booted.payload, {
			path: routes.query,
			query: `source=plausible:${doc.id}&metrics=pageviews&from=2026-10-01&to=2026-10-09`,
			user: userOf('alpha'),
		})
		expect(res.status).toBe(502)
		await expect
			.poll(async () => (await rowsOf(doc.id))[0]?.errorKind, { timeout: 5000 })
			.toBe('source_misconfigured')
		const body = (await (await status('GET', 'alpha', doc.id)).json()) as ProviderStatusResponse
		expect(Date.parse(body.status.pausedUntil ?? '')).toBeGreaterThan(Date.now())
	})

	it(`shows another tenant nothing and checks nothing for it on ${db}`, async () => {
		const doc = await createProvider('alpha', 'private.example')
		for (const method of ['GET', 'POST'] as const) {
			const res = await status(method, 'beta', doc.id)
			expect(res.status, method).toBe(404)
			expect(((await res.json()) as ErrorBody).error.code).toBe('not_found')
		}
		expect(vendor.asked).not.toContain('private.example')
		expect(await rowsOf(doc.id)).toEqual([])
	})

	it(`lets a reader without update access see the status but not run a check on ${db}`, async () => {
		const doc = await createProvider('alpha', 'viewer.example')
		expect((await status('GET', 'alpha-viewer', doc.id)).status).toBe(200)
		const refused = await status('POST', 'alpha-viewer', doc.id)
		expect(refused.status).toBe(403)
		expect(vendor.asked).not.toContain('viewer.example')
	})

	it(`refuses a request without a user, a missing id and an unknown one on ${db}`, async () => {
		expect((await status('GET', null, 'x')).status).toBe(401)
		const missing = await status('GET', 'alpha', '   ')
		expect(missing.status).toBe(400)
		expect(((await missing.json()) as ErrorBody).error.param).toBe('id')
		expect(
			(await status('GET', 'alpha', db === 'mongo' ? '0123456789abcdef01234567' : '999999')).status
		).toBe(404)
	})

	it(`answers a second check this soon from the first, asking the vendor once, on ${db}`, async () => {
		const doc = await createProvider('alpha', 'twice.example')
		await status('POST', 'alpha', doc.id)
		const again = (await (await status('POST', 'alpha', doc.id)).json()) as ProviderStatusResponse
		expect(again.checked).toBeUndefined()
		expect(again.status.lastSuccessAt).toEqual(expect.any(String))
		expect(vendor.asked.filter((site) => site === 'twice.example')).toHaveLength(1)
	})

	it(`deletes a document's status row with the document on ${db}`, async () => {
		const doc = await createProvider('alpha', 'gone.example')
		await status('POST', 'alpha', doc.id)
		expect(await rowsOf(doc.id)).toHaveLength(1)
		await booted.payload.delete({ collection: PROVIDERS_SLUG, id: doc.id, overrideAccess: true })
		expect(await rowsOf(doc.id)).toEqual([])
	})
})
