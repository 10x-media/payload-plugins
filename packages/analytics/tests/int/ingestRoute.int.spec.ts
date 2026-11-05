import {
	type BootedPayload,
	bootPayload,
	describeForDb,
	installTestClock,
	type TestClock,
} from '@10x-media/payload-test-harness'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { signItemRef } from '../../src/native/ingest/itemSignature'
import { native } from '../../src/native/nativeAdapter'
import { ingestRoute } from '../../src/next/ingestRoute'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { type StoredHit, storedHits } from './nativeHelpers'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const goals: Goal[] = [
	{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
]

const CHROME =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** A beacon as a browser on `shop.example` sends it, signed in to the admin as well. */
const beacon = (body: unknown, headers: Record<string, string> = {}): Request =>
	new Request(`http://shop.example/api${routes.ingest}`, {
		method: 'POST',
		body: typeof body === 'string' ? body : JSON.stringify(body),
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			host: 'shop.example',
			'user-agent': CHROME,
			'accept-language': 'de-DE,de;q=0.9',
			'x-vercel-ip-country': 'DE',
			cookie: 'payload-token=editor-session',
			...headers,
		},
	})

/** A stored hit without what differs between two writes of one beacon: its id and its times. */
const contentOf = (hit: StoredHit | undefined): Record<string, unknown> => {
	const { id: _id, ts: _ts, lastAt: _lastAt, path: _path, ...rest } = hit ?? {}
	return rest
}

describeForDb('ingestRoute', {}, (db) => {
	let booted: BootedPayload
	let clock: TestClock
	const seenByScope: Array<{ cookie: string | null; user: unknown }> = []
	let route: (request: Request) => Promise<Response>

	beforeAll(async () => {
		// Held still: the endpoint's hit and the route's match only when both hash the visitor with
		// one day's salt.
		clock = installTestClock(new Date())
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				trustedPlatform: 'vercel',
				goals,
				collections: { offers: { item: true, scopeField: false } },
				scope: {
					member: () => true,
					resolve: ({ req }) => {
						seenByScope.push({ cookie: req.headers.get('cookie'), user: req.user })
						return req.headers.get('host') === 'shop.example' ? 'shop' : null
					},
				},
			}),
			collections: [{ slug: 'offers', fields: [{ name: 'title', type: 'text' }] }],
		})
		route = ingestRoute(booted.payload.config, { key: booted.cacheKey })
	}, 240_000)

	afterAll(async () => {
		clock?.reset()
		await booted.stop()
	})

	const viaEndpoint = (request: Request) =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request,
		})

	it(`stores what the Payload endpoint stores for the same beacon on ${db}`, async () => {
		const body = (path: string) => ({
			type: 'pageview',
			path,
			referrer: 'https://www.google.com/search?q=boots',
			query: 'utm_source=spring&utm_medium=cpc&gclid=abc',
			scrollDepth: 0,
		})
		expect((await viaEndpoint(beacon(body('/thank-you')))).status).toBe(202)
		expect((await route(beacon(body('/thank-you')))).status).toBe(202)
		const [fromEndpoint, fromRoute] = await storedHits(booted.payload, {
			path: { equals: '/thank-you' },
		})
		expect(contentOf(fromRoute)).toEqual(contentOf(fromEndpoint))
		expect(fromRoute).toMatchObject({
			scope: 'shop',
			hostname: 'shop.example',
			country: 'DE',
			language: 'de-de',
			ref: 'google.com',
			clickId: 'gclid',
			goals: [{ slug: 'thanks', value: 0 }],
		})
	})

	it(`stores an engagement and a goal event as the endpoint does on ${db}`, async () => {
		const engagement = { type: 'engagement', path: '/pricing', durationMs: 3000, sinceMs: 60_000 }
		const signup = { type: 'event', name: 'signup', path: '/pricing', props: { plan: 'pro' } }
		for (const body of [engagement, signup]) {
			expect((await viaEndpoint(beacon(body))).status).toBe(202)
			expect((await route(beacon(body))).status).toBe(202)
		}
		const stored = await storedHits(booted.payload, { path: { equals: '/pricing' } })
		const byType = (type: string) => stored.filter((hit) => hit.type === type).map(contentOf)
		expect(byType('engagement')).toHaveLength(2)
		expect(byType('engagement')[1]).toEqual(byType('engagement')[0])
		expect(byType('event')).toHaveLength(2)
		expect(byType('event')[1]).toEqual(byType('event')[0])
	})

	// Payload's REST routing signs every request in; the route runs no auth strategy, and the
	// host's resolvers see the visit without the editor's session either way.
	it(`asks the host's resolvers about the visit, never the signed-in editor, on ${db}`, async () => {
		seenByScope.length = 0
		await route(beacon({ type: 'pageview', path: '/visit' }))
		expect(seenByScope.length).toBeGreaterThan(0)
		expect(seenByScope.every((seen) => seen.cookie === null && seen.user === null)).toBe(true)
	})

	it(`keeps a signed item ref and drops an unsigned one, as the endpoint does, on ${db}`, async () => {
		const offer = await booted.payload.create({
			collection: 'offers',
			data: { title: 'Spring sale' },
		})
		const ref = `offers:${String(offer.id)}`
		const signed = signItemRef(booted.payload, 'offers', offer.id) ?? ''
		expect(signed).not.toBe(ref)
		const seen = (path: string, impressions: string[]) =>
			beacon({ type: 'engagement', path, durationMs: 1000, sinceMs: 1000, impressions })
		for (const send of [route, viaEndpoint]) {
			expect((await send(seen('/signed', [signed]))).status).toBe(202)
			expect((await send(seen('/unsigned', [ref]))).status).toBe(202)
		}
		const impressionsOn = async (path: string) =>
			(await storedHits(booted.payload, { path: { equals: path } })).map((hit) => hit.impressions)
		expect(await impressionsOn('/signed')).toEqual([[ref], [ref]])
		const unsigned = await impressionsOn('/unsigned')
		expect(unsigned).toHaveLength(2)
		expect(unsigned.every((impressions) => impressions === undefined || impressions === null)).toBe(
			true
		)
	})

	it(`refuses what the endpoint refuses, and drops what it drops, alike on ${db}`, async () => {
		for (const body of ['<html>nope</html>', JSON.stringify({ type: 'pageview' })]) {
			const [endpoint, direct] = await Promise.all([viaEndpoint(beacon(body)), route(beacon(body))])
			expect(direct.status).toBe(400)
			expect(direct.status).toBe(endpoint.status)
			expect(await direct.json()).toEqual(await endpoint.json())
		}
		const bot = { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' }
		const crossSite = { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }
		const unscoped = { host: 'stranger.example' }
		for (const headers of [bot, crossSite, unscoped]) {
			const res = await route(beacon({ type: 'pageview', path: '/dropped' }, headers))
			expect(res.status).toBe(202)
			expect(await res.json()).toEqual({ ok: true })
		}
		expect(await storedHits(booted.payload, { path: { equals: '/dropped' } })).toEqual([])
	})
})

describeForDb('ingestRoute without the native adapter', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ db, plugin: analytics({ adapters: [memoryAdapter()] }) })
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it(`answers 404 when the install runs no native adapter on ${db}`, async () => {
		const res = await ingestRoute(booted.payload.config, { key: booted.cacheKey })(
			beacon({ type: 'pageview', path: '/nowhere' })
		)
		expect(res.status).toBe(404)
		expect(await res.json()).toMatchObject({ error: { code: 'not_found' } })
	})
})
