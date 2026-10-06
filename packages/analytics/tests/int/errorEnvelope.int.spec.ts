import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest, TypedUser } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { makeProxyHandler } from '../../src/capture/proxyEndpoint'
import type { AnalyticsAdapter } from '../../src/core/contract'
import { makeGoalsHandler } from '../../src/goals/goalsEndpoint'
import { analytics } from '../../src/index'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'
import { makeDocumentHandler } from '../../src/plugin/documentEndpoint'
import {
	DOCUMENT_PATH,
	GOALS_PATH,
	PROXY_PATH,
	REALTIME_PATH,
	SOURCES_PATH,
} from '../../src/plugin/paths'
import { makeRealtimeHandler } from '../../src/plugin/realtimeEndpoint'
import { makeSourcesHandler } from '../../src/plugin/sourcesEndpoint'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { ingestRequest } from './ingestRequest'

type ErrorBody = { error: { code: string; message: string; param?: string } }

const NO_STORE = 'private, no-store'

/** Every error answer is the envelope and nothing else; the code is returned for the case. */
const errorOf = async (res: Response): Promise<ErrorBody['error']> => {
	const body: unknown = await res.json()
	expect(Object.keys(body as Record<string, unknown>)).toEqual(['error'])
	const { error } = body as ErrorBody
	expect(typeof error).toBe('object')
	expect(typeof error.code).toBe('string')
	expect(typeof error.message).toBe('string')
	return error
}

const userWith = (email: string): TypedUser =>
	({ id: `user-${email}`, collection: 'users', email }) as unknown as TypedUser

const ALLOWED = userWith('allowed@t.dev')
const DENIED = userWith('denied@t.dev')
const BROKEN = userWith('broken@t.dev')

/** A source whose realtime read always rejects, the way a provider outage arrives. */
const failingRealtime = (): AnalyticsAdapter => ({
	...memoryAdapter(),
	id: 'failing',
	label: 'Failing source',
	realtime: () => Promise.reject(new Error('provider is down')),
})

/**
 * A source declaring a capture proxy whose upstream cannot be reached, so the proxy's own
 * refusals (413, 400, 502) can be read without a vendor.
 */
const deadUpstream = (): AnalyticsAdapter => ({
	...memoryAdapter(),
	id: 'vendor',
	label: 'Vendor',
	capture: {
		proxy: { routes: [{ source: '/:p*', upstream: 'http://127.0.0.1:1/:p*' }] },
		snippet: () => ({ scripts: [] }),
		client: { kind: 'posthog' },
	},
})

/** A body that errors mid-read, the way a beacon from an unloading tab arrives. */
const dyingBody = (): ReadableStream<Uint8Array> =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(10).fill(65))
		},
		pull(controller) {
			controller.error(new Error('client went away'))
		},
	})

const pages: CollectionConfig = {
	slug: 'pages',
	fields: [{ name: 'slug', type: 'text' }],
}

/** Bound like `pages`, but every read of it throws: the document endpoint's 500 path. */
const brittle: CollectionConfig = {
	slug: 'brittle',
	access: {
		read: () => {
			throw new Error('access resolver is misconfigured')
		},
	},
	fields: [{ name: 'slug', type: 'text' }],
}

const path = (doc: Record<string, unknown>) => (doc.slug ? `/${String(doc.slug)}` : null)

describeForDb('every endpoint answers errors in one envelope', {}, (db) => {
	let booted: BootedPayload
	let goneId: string

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [pages, brittle],
			db,
			plugin: analytics({
				adapters: [native(), failingRealtime(), deadUpstream()],
				collections: { pages: { path }, brittle: { path } },
				capture: { slots: { global: 'vendor' }, proxy: { timeoutMs: 300, maxBodyBytes: 1024 } },
				access: {
					read: ({ req }) => {
						const email = (req.user as { email?: string } | null)?.email
						if (email === 'broken@t.dev') {
							throw new Error('access resolver is misconfigured')
						}
						return email === 'allowed@t.dev'
					},
				},
				goals: { defaults: [{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } }] },
			}),
		})
		const page = await booted.payload.create({
			collection: 'pages' as never,
			data: { slug: 'gone' } as never,
		})
		goneId = String((page as { id: number | string }).id)
		await booted.payload.delete({ collection: 'pages' as never, id: goneId })
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const reqFor = (url: string, user: TypedUser | undefined, payload: unknown = booted.payload) =>
		({ url, user, payload, headers: new Headers() }) as unknown as PayloadRequest

	const noRuntime = { logger: { warn: () => undefined } }

	const document = (query: string, user?: TypedUser, payload?: unknown) =>
		makeDocumentHandler()(reqFor(`http://x/api${DOCUMENT_PATH}?${query}`, user, payload))

	const realtime = (user?: TypedUser, query = 'metric=visitors') =>
		makeRealtimeHandler()(reqFor(`http://x/api${REALTIME_PATH}?${query}`, user))

	const proxy = (init: RequestInit = {}, slot = 'global') =>
		makeProxyHandler()(
			Object.assign(new Request(`http://x/api${PROXY_PATH}/global/e`, init), {
				payload: booted.payload,
				routeParams: { slot },
			}) as unknown as PayloadRequest
		)

	const sources = (user?: TypedUser) =>
		makeSourcesHandler()(reqFor(`http://x/api${SOURCES_PATH}`, user))

	const goals = (user?: TypedUser) => makeGoalsHandler()(reqFor(`http://x/api${GOALS_PATH}`, user))

	it(`answers the document endpoint's 401 as unauthorized, uncached, on ${db}`, async () => {
		const res = await document('collection=pages&id=1')
		expect(res.status).toBe(401)
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(res)).code).toBe('unauthorized')
	})

	it(`answers the document endpoint's 503 as a retryable unavailable on ${db}`, async () => {
		const res = await document('collection=pages&id=1', ALLOWED, noRuntime)
		expect(res.status).toBe(503)
		expect(res.headers.get('retry-after')).toBe('30')
		expect((await errorOf(res)).code).toBe('unavailable')
	})

	it(`answers the document endpoint's 403 as forbidden on ${db}`, async () => {
		const res = await document('collection=pages&id=1', DENIED)
		expect(res.status).toBe(403)
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(res)).code).toBe('forbidden')
	})

	it(`answers an unbound collection as not_found on ${db}`, async () => {
		const res = await document('collection=nope&id=1', ALLOWED)
		expect(res.status).toBe(404)
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(res)).code).toBe('not_found')
	})

	it(`answers a document that no longer exists as not_found on ${db}`, async () => {
		const res = await document(`collection=pages&id=${goneId}`, ALLOWED)
		expect(res.status).toBe(404)
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(res)).code).toBe('not_found')
	})

	// An id no database could hold is a request that is wrong, not an install that is broken:
	// mongo disregards an invalid `_id` and postgres reads a non-numeric id as null, so both
	// raise NotFound. Pinned because a `findByID` that validated ids instead would turn this
	// into a logged 500 any reader could loop.
	it(`answers a malformed document id as not_found rather than internal on ${db}`, async () => {
		const res = await document('collection=pages&id=not-an-id', ALLOWED)
		expect(res.status).toBe(404)
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(res)).code).toBe('not_found')
	})

	it(`names the bound at fault when a custom range will not parse on ${db}`, async () => {
		const noOffset = await document(
			'collection=pages&id=1&timeframe=custom&from=2026-06-01T00:00:00&to=2026-06-23T23:59:59',
			ALLOWED
		)
		expect(noOffset.status).toBe(400)
		expect(noOffset.headers.get('cache-control')).toBe(NO_STORE)
		expect(await errorOf(noOffset)).toMatchObject({ code: 'invalid_param', param: 'from' })

		const inverted = await document(
			'collection=pages&id=1&timeframe=custom&from=2026-06-23&to=2026-06-01',
			ALLOWED
		)
		expect(inverted.status).toBe(400)
		expect(await errorOf(inverted)).toMatchObject({ code: 'invalid_param', param: 'to' })
	})

	it(`answers a read that fails for any other reason as a 500 internal on ${db}`, async () => {
		const res = await document('collection=brittle&id=1', ALLOWED)
		expect(res.status).toBe(500)
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(res)).code).toBe('internal')
	})

	it(`answers the realtime endpoint's 401 and 403 in the envelope on ${db}`, async () => {
		const anonymous = await realtime()
		expect(anonymous.status).toBe(401)
		expect(anonymous.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(anonymous)).code).toBe('unauthorized')

		const denied = await realtime(DENIED)
		expect(denied.status).toBe(403)
		expect(denied.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(denied)).code).toBe('forbidden')
	})

	it(`answers a realtime source that is down as a retryable unavailable on ${db}`, async () => {
		const res = await realtime(ALLOWED, 'metric=visitors&dataSource=failing')
		expect(res.status).toBe(503)
		expect(res.headers.get('retry-after')).toBe('30')
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(res)).code).toBe('unavailable')
	})

	// A gate that throws is a configuration bug, so it is the 500 rather than the retryable 503.
	it(`answers a realtime request that fails before the read as internal on ${db}`, async () => {
		const res = await realtime(BROKEN)
		expect(res.status).toBe(500)
		expect(res.headers.get('retry-after')).toBeNull()
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(res)).code).toBe('internal')
	})

	it(`answers the sources endpoint's 401 and 403 in the envelope on ${db}`, async () => {
		const anonymous = await sources()
		expect(anonymous.status).toBe(401)
		expect(anonymous.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(anonymous)).code).toBe('unauthorized')

		const denied = await sources(DENIED)
		expect(denied.status).toBe(403)
		expect(denied.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(denied)).code).toBe('forbidden')
	})

	it(`answers the goals endpoint's 401 and 403 in the envelope on ${db}`, async () => {
		const anonymous = await goals()
		expect(anonymous.status).toBe(401)
		expect(anonymous.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(anonymous)).code).toBe('unauthorized')

		const denied = await goals(DENIED)
		expect(denied.status).toBe(403)
		expect(denied.headers.get('cache-control')).toBe(NO_STORE)
		expect((await errorOf(denied)).code).toBe('forbidden')
	})

	it(`keeps a goals listing out of every shared cache on ${db}`, async () => {
		const res = await goals(ALLOWED)
		expect(res.status).toBe(200)
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
	})

	it(`names the first field an invalid event fails on, in the envelope, on ${db}`, async () => {
		const handler = makeIngestHandler({ geoResolver: platformHeaderResolver })
		const res = await handler(ingestRequest(booted.payload, { type: 'pageview', hostname: 'h' }))
		expect(res.status).toBe(400)
		expect(await errorOf(res)).toMatchObject({ code: 'invalid_param', param: 'path' })
	})

	// A body that died in transit names no field, because none of them was ever read.
	it(`answers an unreadable event body as an invalid_param naming nothing on ${db}`, async () => {
		const handler = makeIngestHandler({ geoResolver: platformHeaderResolver })
		const res = await handler(
			Object.assign(
				new Request('http://x/api/analytics/ingest', {
					method: 'POST',
					body: dyingBody(),
					// A visitor's agent: the bot filter answers 202 before a body is ever read.
					headers: {
						'content-type': 'application/json',
						'user-agent': 'Mozilla/5.0 Firefox/126.0',
					},
					// @ts-expect-error duplex is required for a stream body and absent from lib.dom
					duplex: 'half',
				}),
				{ payload: booted.payload }
			) as unknown as PayloadRequest
		)
		expect(res.status).toBe(400)
		expect(res.headers.get('cache-control')).toBe(NO_STORE)
		const error = await errorOf(res)
		expect(error.code).toBe('invalid_param')
		expect(error.param).toBeUndefined()
	})

	it(`answers an event body over the cap as payload_too_large on ${db}`, async () => {
		const handler = makeIngestHandler({ geoResolver: platformHeaderResolver })
		const res = await handler(
			ingestRequest(booted.payload, {
				type: 'pageview',
				path: '/big',
				hostname: 'h',
				props: { note: 'x'.repeat(70_000) },
			})
		)
		expect(res.status).toBe(413)
		expect((await errorOf(res)).code).toBe('payload_too_large')
	})

	it(`leaves the capture proxy bodyless, the one endpoint that sends no envelope, on ${db}`, async () => {
		const unknownSlot = await proxy({}, 'admin')
		expect(unknownSlot.status).toBe(404)
		expect(await unknownSlot.text()).toBe('')

		const tooLarge = await proxy({ method: 'POST', body: 'x'.repeat(2048) })
		expect(tooLarge.status).toBe(413)
		expect(await tooLarge.text()).toBe('')

		const unreadable = await proxy({
			method: 'POST',
			body: dyingBody(),
			// @ts-expect-error duplex is required for a stream body and absent from lib.dom
			duplex: 'half',
		})
		expect(unreadable.status).toBe(400)
		expect(await unreadable.text()).toBe('')

		// The declared upstream refuses every connection, which is what an outage looks like.
		const upstreamDown = await proxy()
		expect(upstreamDown.status).toBe(502)
		expect(await upstreamDown.text()).toBe('')
	})
})
