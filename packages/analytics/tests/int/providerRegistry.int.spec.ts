import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { decryptFieldValue } from '@10x-media/fields/encrypted'
import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { sqliteTestAdapter } from '@10x-media/payload-test-harness/db/sqlite'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AnalyticsAdapter, AnalyticsQuery } from '../../src/core/contract'
import type { Ga4Sdk } from '../../src/core/sdks'
import { GOALS_SLUG } from '../../src/goals/collection'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { type AnalyticsRuntime, getRuntime, resolveRegistryFor } from '../../src/plugin/runtime'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import { PROBE_MEMO_MS } from '../../src/providers/probe'
import { refreshProviders } from '../../src/providers/refresh'
import { configEpochKeyFor } from '../../src/surfacing/epoch'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { nativeOf, postBeacon, storedHits } from './nativeHelpers'

vi.mock('@10x-media/fields/encrypted', async (importOriginal) => {
	const original = await importOriginal<typeof import('@10x-media/fields/encrypted')>()
	return { ...original, decryptFieldValue: vi.fn(original.decryptFieldValue) }
})

const decrypts = vi.mocked(decryptFieldValue)

/** What the Plausible stand-in answers for each site: which site an adapter reads is its answer. */
const PAGEVIEWS: Record<string, number> = {
	'committed.example': 1,
	'uncommitted.example': 2,
	'next.example': 3,
}

/** A Plausible query API on loopback, recording every site it was asked about. */
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
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ results: [{ metrics: [PAGEVIEWS[siteId] ?? 0], dimensions: [] }] }))
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

/** A GA4 SDK whose clients count how many were built and how many were closed. */
const ga4Clients = { built: 0, closed: 0 }
class FakeGa4Client {
	constructor() {
		ga4Clients.built += 1
	}
	async runReport() {
		return [{ rows: [], totals: [] }]
	}
	async close() {
		ga4Clients.closed += 1
	}
}
const fakeGa4 = { BetaAnalyticsDataClient: FakeGa4Client } as unknown as Ga4Sdk

const QUERY: AnalyticsQuery = {
	metrics: ['pageviews'],
	dateRange: {
		start: new Date('2026-01-01T00:00:00.000Z'),
		end: new Date('2026-01-31T23:59:59.999Z'),
	},
}

const runtimeOf = (payload: Payload): AnalyticsRuntime => {
	const runtime = getRuntime(payload)
	if (!runtime) throw new Error('runtime missing')
	return runtime
}

const registryFor = async (payload: Payload, scope: string, req?: PayloadRequest) =>
	(await resolveRegistryFor(runtimeOf(payload), { payload, scope, ...(req ? { req } : {}) }))
		.registry

const ga4Doc = (name: string, scope: string) => ({
	name,
	provider: 'ga4',
	enabled: true,
	scope,
	ga4: { propertyId: '123456', clientEmail: 'sa@x.iam.gserviceaccount.com', privateKey: 'pk' },
})

/** An adapter outside every registry whose answer is how many times a read reached it. */
const countingAdapter = () => {
	let calls = 0
	const adapter: AnalyticsAdapter = {
		id: 'counting',
		label: 'Counting',
		capabilities: memoryAdapter().capabilities,
		isConfigured: () => true,
		query: async (q) => {
			calls += 1
			return {
				rows: [],
				totals: { pageviews: calls },
				meta: { provider: 'counting', fetchedAt: q.dateRange.end.toISOString() },
			}
		},
	}
	return { adapter, calls: () => calls }
}

describeForDb('analytics provider registry: one instance', {}, (db) => {
	let booted: BootedPayload
	let transactional: BootedPayload
	let plausible: Awaited<ReturnType<typeof startPlausible>>

	beforeAll(async () => {
		plausible = await startPlausible()
		const plugin = () =>
			analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
				access: { crossScope: () => true },
				providers: {
					collection: true,
					hosts: { allow: [plausible.origin], allowPrivateNetwork: true },
				},
				goals: { collection: true },
				sdks: { ga4: fakeGa4 },
			})
		booted = await bootPayload({ db, plugin: plugin() })
		// Payload's SQLite adapter opens no transaction unless transactionOptions is set.
		transactional =
			db === 'sqlite'
				? await bootPayload({
						db,
						attachTo: booted,
						plugin: plugin(),
						configOverrides: {
							db: sqliteTestAdapter(booted.connectionString, { transactionOptions: {} }),
						},
					})
				: booted
	}, 240_000)

	afterAll(async () => {
		if (transactional !== booted) {
			await transactional?.stop()
		}
		await booted?.stop()
		await plausible?.stop()
	})

	it(`decrypts a document once, and an unchanged one never again on ${db}`, async () => {
		const { payload } = booted
		const site = await payload.create({
			collection: PROVIDERS_SLUG,
			data: {
				name: 'Site',
				provider: 'plausible',
				enabled: true,
				scope: 'decrypt-a',
				plausible: { siteId: 'committed.example', apiKey: 'plausible-key', host: plausible.origin },
			},
			overrideAccess: true,
		})
		const stats = await payload.create({
			collection: PROVIDERS_SLUG,
			data: {
				name: 'Stats',
				provider: 'umami',
				enabled: true,
				scope: 'decrypt-a',
				umami: { websiteId: 'w-1', apiKey: 'umami-key' },
			},
			overrideAccess: true,
		})
		const before = decrypts.mock.calls.length
		const pathsSince = () => decrypts.mock.calls.slice(before).map(([, args]) => args.path)

		const first = await registryFor(payload, 'decrypt-a')
		expect(first.get(`plausible:${site.id}`).isConfigured()).toBe(true)
		expect(first.get(`umami:${stats.id}`).isConfigured()).toBe(true)
		expect(pathsSince().sort()).toEqual(['plausible.apiKey', 'umami.apiKey'])
		await registryFor(payload, 'decrypt-a')
		expect(pathsSince()).toHaveLength(2)

		// The scope's registry is rebuilt each time, and only the saved document is read again.
		await payload.update({
			collection: PROVIDERS_SLUG,
			id: site.id,
			data: { name: 'Site renamed' },
			overrideAccess: true,
		})
		const renamed = await registryFor(payload, 'decrypt-a')
		expect(renamed.get(`plausible:${site.id}`).label).toBe('Site renamed')
		expect(renamed.get(`umami:${stats.id}`)).toBe(first.get(`umami:${stats.id}`))
		expect(pathsSince().slice(2)).toEqual(['plausible.apiKey'])

		await payload.update({
			collection: PROVIDERS_SLUG,
			id: stats.id,
			data: { name: 'Stats renamed' },
			overrideAccess: true,
		})
		const again = await registryFor(payload, 'decrypt-a')
		expect(again.get(`plausible:${site.id}`)).toBe(renamed.get(`plausible:${site.id}`))
		expect(pathsSince().slice(3)).toEqual(['umami.apiKey'])
	})

	it(`closes the adapter of a changed document, and of a removed one, on ${db}`, async () => {
		const { payload } = booted
		const created = await payload.create({
			collection: PROVIDERS_SLUG,
			data: ga4Doc('Property', 'close-a'),
			overrideAccess: true,
		})
		const id = `ga4:${created.id}`
		const closedBefore = ga4Clients.closed
		const first = (await registryFor(payload, 'close-a')).get(id)
		await first.query(QUERY, { payload })
		expect(ga4Clients.closed).toBe(closedBefore)

		await payload.update({
			collection: PROVIDERS_SLUG,
			id: created.id,
			data: { name: 'Property renamed' },
			overrideAccess: true,
		})
		const second = (await registryFor(payload, 'close-a')).get(id)
		expect(second).not.toBe(first)
		await vi.waitFor(() => expect(ga4Clients.closed).toBe(closedBefore + 1))

		await second.query(QUERY, { payload })
		await payload.delete({ collection: PROVIDERS_SLUG, id: created.id, overrideAccess: true })
		const after = await registryFor(payload, 'close-a')
		expect(after.all().some((adapter) => adapter.id === id)).toBe(false)
		await vi.waitFor(() => expect(ga4Clients.closed).toBe(closedBefore + 2))
	})

	it(`grants ingest from the committed rows, reading and decrypting no document, on ${db}`, async () => {
		const { payload } = booted
		for (const [scope, provider] of [
			['grant-a', 'native'],
			['grant-a', 'plausible'],
			['grant-b', 'plausible'],
		] as const) {
			await payload.create({
				collection: PROVIDERS_SLUG,
				data: {
					name: `${scope} ${provider}`,
					provider,
					enabled: true,
					scope,
					...(provider === 'plausible'
						? { plausible: { siteId: 'committed.example', apiKey: 'plausible-key' } }
						: {}),
				},
				overrideAccess: true,
			})
		}
		const find = vi.spyOn(payload, 'find')
		const before = decrypts.mock.calls.length
		try {
			const kept = await postBeacon(
				payload,
				{ type: 'pageview', path: '/granted' },
				{ 'x-tenant': 'grant-a' }
			)
			const dropped = await postBeacon(
				payload,
				{ type: 'pageview', path: '/not-granted' },
				{ 'x-tenant': 'grant-b' }
			)
			expect(kept.status).toBe(202)
			expect(dropped.status).toBe(202)
			expect(decrypts.mock.calls.length).toBe(before)
			const providerReads = find.mock.calls.filter(([args]) => args.collection === PROVIDERS_SLUG)
			expect(providerReads).toHaveLength(0)
		} finally {
			find.mockRestore()
		}
		expect(await storedHits(payload, { path: { equals: '/granted' } })).toHaveLength(1)
		expect(await storedHits(payload, { path: { equals: '/not-granted' } })).toHaveLength(0)
	})

	it(`never caches the state of a transaction that has not committed on ${db}`, async () => {
		const { payload } = transactional
		const runtime = runtimeOf(payload)
		const scope = 'tx-a'
		const created = await payload.create({
			collection: PROVIDERS_SLUG,
			data: {
				name: 'Committed',
				provider: 'plausible',
				enabled: true,
				scope,
				plausible: { siteId: 'committed.example', apiKey: 'plausible-key', host: plausible.origin },
			},
			overrideAccess: true,
		})
		const id = `plausible:${created.id}`
		const read = async (req?: PayloadRequest, q: AnalyticsQuery = QUERY) => {
			const adapter = (await registryFor(payload, scope, req)).get(id)
			const result = await runtime.engine.read(adapter, { ...q, scope })
			return { label: adapter.label, pageviews: result.totals?.pageviews }
		}
		const epochOf = () => runtime.configEpoch?.(scope)
		expect(await read()).toEqual({ label: 'Committed', pageviews: 1 })
		const committed = await epochOf()

		const update = async (data: Record<string, unknown>) => {
			const transactionID = await payload.db.beginTransaction()
			expect(transactionID).toBeTruthy()
			const req = await createLocalReq({}, payload)
			req.transactionID = transactionID ?? undefined
			await payload.update({
				collection: PROVIDERS_SLUG,
				id: created.id,
				data,
				req,
				overrideAccess: true,
			})
			return { req, transactionID: transactionID ?? '' }
		}

		const rolledBack = await update({
			name: 'Uncommitted',
			plausible: { siteId: 'uncommitted.example', apiKey: 'plausible-key' },
		})
		// Asked with the very request holding the transaction, which sees its own write.
		expect(await read(rolledBack.req)).toEqual({ label: 'Committed', pageviews: 1 })
		expect(await epochOf()).toBe(committed)
		// A miss writes to the cache, which SQLite's one writer cannot take while the host holds it.
		if (db !== 'sqlite') {
			const february = {
				...QUERY,
				dateRange: { start: new Date('2026-02-01'), end: new Date('2026-02-28T23:59:59.999Z') },
			}
			expect(await read(rolledBack.req, february)).toEqual({ label: 'Committed', pageviews: 1 })
		}
		await payload.db.rollbackTransaction(rolledBack.transactionID)
		expect(await read()).toEqual({ label: 'Committed', pageviews: 1 })
		expect(await epochOf()).toBe(committed)
		expect(plausible.asked).not.toContain('uncommitted.example')

		const kept = await update({
			name: 'Next',
			plausible: { siteId: 'next.example', apiKey: 'plausible-key' },
		})
		expect(await read(kept.req)).toEqual({ label: 'Committed', pageviews: 1 })
		await payload.db.commitTransaction(kept.transactionID)
		expect(await read()).toEqual({ label: 'Next', pageviews: 3 })
		expect(await epochOf()).not.toBe(committed)
	})

	it(`never resolves a goal a transaction has not committed on ${db}`, async () => {
		const { payload } = transactional
		const runtime = runtimeOf(payload)
		const scope = 'tx-g'
		const slugsFor = async (req: PayloadRequest) =>
			((await runtime.resolveGoals?.(req, scope)) ?? []).map((goal) => goal.slug)
		const outside = await createLocalReq({}, payload)
		expect(await slugsFor(outside)).not.toContain('pending')
		const committed = await runtime.configEpoch?.(scope)

		const transactionID = await payload.db.beginTransaction()
		expect(transactionID).toBeTruthy()
		const req = await createLocalReq({}, payload)
		req.transactionID = transactionID ?? undefined
		await payload.create({
			collection: GOALS_SLUG,
			data: { name: 'Pending', slug: 'pending', enabled: true, scope, match: { kind: 'goal' } },
			req,
			overrideAccess: true,
		})
		expect(await slugsFor(req)).not.toContain('pending')
		expect(await runtime.configEpoch?.(scope)).toBe(committed)
		await payload.db.rollbackTransaction(transactionID ?? '')
		expect(await slugsFor(outside)).not.toContain('pending')
		expect(await runtime.configEpoch?.(scope)).toBe(committed)
	})
})

describeForDb('analytics provider registry: two instances on one database', {}, (db) => {
	let first: BootedPayload
	let second: BootedPayload
	let clock: TestClock
	const counting = countingAdapter()

	const plugin = () =>
		analytics({
			adapters: [memoryAdapter()],
			capture: { gate: 'off' },
			scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
			access: { crossScope: () => true },
			providers: { collection: true },
			goals: { collection: true },
			sdks: { ga4: fakeGa4 },
		})

	beforeAll(async () => {
		clock = installTestClock(new Date('2026-10-07T12:00:00.000Z'))
		first = await bootPayload({ db, plugin: plugin() })
		second = await bootPayload({ db, plugin: plugin(), attachTo: first })
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await second?.stop()
		await first?.stop()
	})

	const readOn = async (booted: BootedPayload, scope: string) =>
		(await runtimeOf(booted.payload).engine.read(counting.adapter, { ...QUERY, scope })).totals
			?.pageviews

	it(`retires the other instance's cached reads within the probe window after a provider save on ${db}`, async () => {
		const cached = await readOn(second, 'converge-a')
		expect(await readOn(second, 'converge-a')).toBe(cached)
		await first.payload.create({
			collection: PROVIDERS_SLUG,
			data: {
				name: 'Saved elsewhere',
				provider: 'plausible',
				enabled: true,
				scope: 'converge-a',
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			},
			overrideAccess: true,
		})
		clock.advance(PROBE_MEMO_MS - 1)
		expect(await readOn(second, 'converge-a')).toBe(cached)
		clock.advance(1)
		const fresh = await readOn(second, 'converge-a')
		expect(fresh).toBe(counting.calls())
		expect(fresh).not.toBe(cached)
	})

	it(`retires the other instance's cached reads within the probe window after a goal save on ${db}`, async () => {
		const cached = await readOn(second, 'converge-g')
		await first.payload.create({
			collection: GOALS_SLUG,
			data: {
				name: 'Lead',
				slug: 'lead',
				enabled: true,
				scope: 'converge-g',
				match: { kind: 'goal' },
			},
			overrideAccess: true,
		})
		expect(await readOn(second, 'converge-g')).toBe(cached)
		clock.advance(PROBE_MEMO_MS)
		expect(await readOn(second, 'converge-g')).not.toBe(cached)
	})

	it(`closes its own adapter of a document another instance removed on ${db}`, async () => {
		const created = await first.payload.create({
			collection: PROVIDERS_SLUG,
			data: ga4Doc('Shared property', 'converge-c'),
			overrideAccess: true,
		})
		const id = `ga4:${created.id}`
		const adapter = (await registryFor(second.payload, 'converge-c')).get(id)
		await adapter.query(QUERY, { payload: second.payload })
		const closedBefore = ga4Clients.closed
		await first.payload.delete({ collection: PROVIDERS_SLUG, id: created.id, overrideAccess: true })
		expect((await registryFor(second.payload, 'converge-c')).all().map((a) => a.id)).toContain(id)
		clock.advance(PROBE_MEMO_MS)
		expect((await registryFor(second.payload, 'converge-c')).all().map((a) => a.id)).not.toContain(
			id
		)
		await vi.waitFor(() => expect(ga4Clients.closed).toBe(closedBefore + 1))
	})
})

describeForDb('analytics refreshProviders: providers.resolve installs', {}, (db) => {
	let clock: TestClock
	const instances: BootedPayload[] = []

	const plugin = (adapters: AnalyticsAdapter[]) =>
		analytics({
			adapters,
			capture: { gate: 'off' },
			scope: { member: () => true, resolve: ({ req }) => req.headers.get('x-tenant') },
			access: { crossScope: () => true },
			providers: { resolve: async () => [] },
		})

	beforeAll(() => {
		clock = installTestClock(new Date('2026-10-07T12:00:00.000Z'))
	})

	afterAll(async () => {
		clock?.reset()
		for (const booted of instances.reverse()) {
			await booted.stop()
		}
	})

	const pair = async (adapters: () => AnalyticsAdapter[]) => {
		const first = await bootPayload({ db, plugin: plugin(adapters()) })
		const second = await bootPayload({ db, plugin: plugin(adapters()), attachTo: first })
		instances.push(first, second)
		return { first, second }
	}

	const retires = async (
		{ first, second }: { first: BootedPayload; second: BootedPayload },
		scope: string
	) => {
		const counting = countingAdapter()
		// Answers are written in the background, so the other instance finds one once its write lands.
		const readOn = async (booted: BootedPayload, at: string) => {
			const { engine } = runtimeOf(booted.payload)
			const result = await engine.read(counting.adapter, { ...QUERY, scope: at })
			await engine.idle?.()
			return result.totals?.pageviews
		}
		expect(await readOn(first, scope)).toBe(1)
		expect(await readOn(second, scope)).toBe(1)
		expect(await readOn(first, 'untouched')).toBe(2)
		await refreshProviders(first.payload, scope)
		expect(await readOn(first, scope)).toBe(3)
		expect(await readOn(second, scope)).toBe(1)
		clock.advance(PROBE_MEMO_MS)
		expect(await readOn(second, scope)).toBe(3)
		expect(await readOn(second, 'untouched')).toBe(2)
	}

	it(`keeps the token in analytics-state beside the native engine on ${db}`, async () => {
		const booted = await pair(() => [native()])
		await retires(booted, 'refresh-state')
		expect(await nativeOf(booted.first.payload).state.configToken('refresh-state')).not.toBeNull()
		expect(await booted.first.payload.kv.get(configEpochKeyFor('refresh-state'))).toBeNull()
	}, 240_000)

	it(`keeps the token in payload.kv without one on ${db}`, async () => {
		const booted = await pair(() => [memoryAdapter()])
		await retires(booted, 'refresh-kv')
		expect(await booted.first.payload.kv.get(configEpochKeyFor('refresh-kv'))).not.toBeNull()
	}, 240_000)
})
