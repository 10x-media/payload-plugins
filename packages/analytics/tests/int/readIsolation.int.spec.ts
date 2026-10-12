import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest, TypedUser } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { callEndpoint, handlerAt } from './endpointHelpers'
import { hitOf } from './hitFixtures'
import { nativeOf } from './nativeHelpers'

const routes = routePaths(DEFAULT_ROUTE_BASE)

type ErrorBody = { error: { code: string; param?: string } }

const userOf = (id: string): TypedUser => ({ id, collection: 'users' }) as unknown as TypedUser

const get = (booted: BootedPayload, call: { path: string; who: string; query: string }) =>
	callEndpoint(booted.payload, { path: call.path, query: call.query, user: userOf(call.who) })

const refresh = (booted: BootedPayload, who: string, scope: string) =>
	Promise.resolve(
		handlerAt(
			booted.payload,
			routes.refresh
		)({
			payload: booted.payload,
			user: userOf(who),
			url: `http://localhost/api${routes.refresh}`,
			headers: new Headers(),
			arrayBuffer: async () =>
				new TextEncoder().encode(JSON.stringify({ scope })).buffer as ArrayBuffer,
		} as unknown as PayloadRequest)
	)

const epochRows = async (booted: BootedPayload): Promise<number> =>
	(
		await booted.payload.db.find({
			collection: 'payload-kv',
			where: { key: { like: 'analytics:epoch' } },
			limit: 0,
			pagination: false,
		})
	).docs.length

const RANGE = 'from=2026-10-01&to=2026-10-09'

describeForDb('analytics read isolation: one tenant against another', {}, (db) => {
	let booted: BootedPayload
	const TENANT: Record<string, string> = { alpha: 'alpha', beta: 'beta' }

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				scope: {
					resolve: ({ req }) => TENANT[String(req.user?.id)] ?? null,
					member: ({ req, scope }) => TENANT[String(req.user?.id)] === scope,
				},
				access: { crossScope: { named: ({ req }) => req.user?.id === 'platform' } },
			}),
		})
		const at = new Date('2026-10-05T10:00:00.000Z')
		await nativeOf(booted.payload).store.append([
			hitOf('alpha', { ts: at, hostname: 'alpha.example' }),
			hitOf('beta', { ts: at, hostname: 'beta.example' }),
		])
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`never lets one tenant's refused filter patterns rest another tenant's native reads on ${db}`, async () => {
		const before = await get(booted, {
			path: routes.query,
			who: 'beta',
			query: `metrics=pageviews&${RANGE}`,
		})
		expect(before.status).toBe(200)
		for (const n of [1, 2, 3, 4, 5, 6]) {
			const filters = encodeURIComponent(
				JSON.stringify([{ dimension: 'page', operator: 'matches', value: `[^]${n}` }])
			)
			const refused = await get(booted, {
				path: routes.query,
				who: 'alpha',
				query: `metrics=pageviews&${RANGE}&filters=${filters}`,
			})
			expect(refused.status).toBe(400)
			const { error } = (await refused.json()) as ErrorBody
			expect(['invalid_param', 'unsupported_operator']).toContain(error.code)
		}
		const after = await get(booted, {
			path: routes.query,
			who: 'beta',
			query: `metrics=pageviews,visitors&${RANGE}`,
		})
		expect(after.status).toBe(200)
	})

	it(`bumps no epoch for a scope nothing belongs to, and refuses an overlong one, on ${db}`, async () => {
		const rows = await epochRows(booted)
		const unknown = await refresh(booted, 'platform', 'made-up')
		expect(unknown.status).toBe(200)
		expect(await epochRows(booted)).toBe(rows)
		const overlong = await refresh(booted, 'platform', 'x'.repeat(2_000))
		expect(overlong.status).toBe(400)
		expect(await epochRows(booted)).toBe(rows)
		const own = await refresh(booted, 'alpha', 'alpha')
		expect(own.status).toBe(200)
	})
})

describeForDb('analytics read bounds: ranges, sync rows and named scopes', {}, (db) => {
	let booted: BootedPayload
	let pageId: string

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				sync: true,
				access: { read: ({ req }) => req.user?.id === 'boss' },
				collections: {
					pages: { path: (doc) => (typeof doc.slug === 'string' ? `/${doc.slug}` : null) },
				},
			}),
			collections: [
				{
					slug: 'pages',
					access: { read: () => true },
					fields: [
						{ name: 'title', type: 'text' },
						{ name: 'slug', type: 'text' },
					],
				},
			],
		})
		const page = await booted.payload.create({
			collection: 'pages' as never,
			data: { title: 'About', slug: 'about' } as never,
		})
		pageId = String((page as { id: string | number }).id)
	}, 240_000)

	afterAll(async () => {
		await booted?.stop()
	})

	it(`refuses a document range longer than the query endpoint's cap, and years before 1970, on ${db}`, async () => {
		const tooLong = await get(booted, {
			path: routes.document,
			who: 'boss',
			query: `collection=pages&id=${pageId}&timeframe=custom&from=2024-01-01&to=2026-10-08`,
		})
		expect(tooLong.status).toBe(400)
		expect(((await tooLong.json()) as ErrorBody).error).toMatchObject({
			code: 'range_too_long',
			param: 'to',
		})
		const started = performance.now()
		const ancient = await get(booted, {
			path: routes.document,
			who: 'boss',
			query: `collection=pages&id=${pageId}&timeframe=custom&from=1000-01-01&to=2026-10-08&compare=1&series=1`,
		})
		expect(ancient.status).toBe(400)
		expect(((await ancient.json()) as ErrorBody).error.param).toBe('from')
		expect(performance.now() - started).toBeLessThan(2_000)
		const inRange = await get(booted, {
			path: routes.document,
			who: 'boss',
			query: `collection=pages&id=${pageId}&timeframe=custom&from=2026-01-01&to=2026-10-08`,
		})
		expect(inRange.status).toBe(200)
	})

	it(`keeps the synced rows from a user access.read denies on ${db}`, async () => {
		await booted.payload.db.create({
			collection: 'analytics-daily',
			data: { source: 'native', date: '2026-10-05T00:00:00.000Z', scope: '', pageviews: 3 },
		})
		const asBoss = await booted.payload.find({
			collection: 'analytics-daily' as never,
			overrideAccess: false,
			user: userOf('boss'),
		})
		expect(asBoss.totalDocs).toBe(1)
		const asReader = await booted.payload
			.find({
				collection: 'analytics-daily' as never,
				overrideAccess: false,
				user: userOf('reader'),
			})
			.then(
				(found) => found.totalDocs,
				() => 0
			)
		expect(asReader).toBe(0)
	})

	it(`refuses a named scope on an install without tenants, writing nothing, on ${db}`, async () => {
		const rows = await epochRows(booted)
		const named = await refresh(booted, 'boss', 'made-up')
		expect(named.status).toBe(400)
		expect(((await named.json()) as ErrorBody).error.code).toBe('untrusted_scope')
		expect(await epochRows(booted)).toBe(rows)
	})
})
