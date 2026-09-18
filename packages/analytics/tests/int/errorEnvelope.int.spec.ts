import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, PayloadRequest, TypedUser } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { makeProxyHandler } from '../../src/capture/proxyEndpoint'
import { makeGoalsHandler } from '../../src/goals/goalsEndpoint'
import { analytics } from '../../src/index'
import { platformHeaderResolver } from '../../src/native/geo/geoResolver'
import { makeIngestHandler } from '../../src/native/ingest/endpoint'
import { native } from '../../src/native/nativeAdapter'
import { makeDocumentHandler } from '../../src/plugin/documentEndpoint'
import { DOCUMENT_PATH, GOALS_PATH, REALTIME_PATH, SOURCES_PATH } from '../../src/plugin/paths'
import { makeRealtimeHandler } from '../../src/plugin/realtimeEndpoint'
import { makeSourcesHandler } from '../../src/plugin/sourcesEndpoint'
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
				adapters: [native()],
				collections: { pages: { path }, brittle: { path } },
				access: {
					read: ({ req }) => (req.user as { email?: string } | null)?.email === 'allowed@t.dev',
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

	const realtime = (user?: TypedUser) =>
		makeRealtimeHandler()(reqFor(`http://x/api${REALTIME_PATH}?metric=visitors`, user))

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
		expect((await errorOf(res)).code).toBe('not_found')
	})

	it(`answers a document that no longer exists as not_found on ${db}`, async () => {
		const res = await document(`collection=pages&id=${goneId}`, ALLOWED)
		expect(res.status).toBe(404)
		expect((await errorOf(res)).code).toBe('not_found')
	})

	it(`names the bound at fault when a custom range will not parse on ${db}`, async () => {
		const noOffset = await document(
			'collection=pages&id=1&timeframe=custom&from=2026-06-01T00:00:00&to=2026-06-23T23:59:59',
			ALLOWED
		)
		expect(noOffset.status).toBe(400)
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
		const handler = makeIngestHandler(platformHeaderResolver)
		const res = await handler(ingestRequest(booted.payload, { type: 'pageview', hostname: 'h' }))
		expect(res.status).toBe(400)
		expect(await errorOf(res)).toMatchObject({ code: 'invalid_param', param: 'path' })
	})

	it(`answers an event body over the cap as payload_too_large on ${db}`, async () => {
		const handler = makeIngestHandler(platformHeaderResolver)
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
		const res = await makeProxyHandler()({
			payload: booted.payload,
			method: 'get',
			routeParams: {},
			headers: new Headers(),
		} as unknown as PayloadRequest)
		expect(res.status).toBe(404)
		expect(await res.text()).toBe('')
	})
})
