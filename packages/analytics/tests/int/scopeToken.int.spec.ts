import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type PayloadRequest, parseCookies } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { requestScopeToken } from '../../src/plugin/scopeToken'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { readerRequest } from './readerRequest'

/** The tenant cookie as a browser sends it, whether or not script on the page could read it. */
const cookie = (tenant: string): Headers => new Headers({ cookie: `payload-tenant=${tenant}` })

// The dev tenancy app's admin resolver, by the multi-tenant plugin's own cookie. A host that sets
// the cookie HttpOnly sends the same header: only the page's script is blind to it.
describeForDb('request scope token, resolved by the tenant cookie', {}, (db) => {
	let booted: BootedPayload
	let resolved = 0

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [memoryAdapter()],
				scope: {
					member: () => true,
					resolve: ({ req }) => {
						resolved += 1
						return parseCookies(req.headers).get('payload-tenant') ?? null
					},
				},
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	/** One admin request, as a surface's server component receives it. */
	const request = (user: string, headers: Headers): PayloadRequest =>
		readerRequest(booted.payload, {
			user: { id: user, collection: booted.payload.config.admin.user },
			headers,
		})

	// A stale import map must never cost the admin: the token is no admin-wide provider.
	it(`wraps nothing around the admin on ${db}`, () => {
		const paths = (booted.payload.config.admin.components?.providers ?? []).map((provider) =>
			typeof provider === 'string' ? provider : provider ? provider.path : ''
		)
		expect(paths.filter((path) => path.includes('@10x-media/analytics'))).toEqual([])
	})

	it(`changes with the tenant the request resolves, and only with it, on ${db}`, async () => {
		const alpha = await requestScopeToken(request('1', cookie('alpha')))
		expect(alpha).toEqual(expect.any(String))
		expect(await requestScopeToken(request('1', cookie('alpha')))).toBe(alpha)
		expect(await requestScopeToken(request('1', cookie('beta')))).not.toBe(alpha)
		expect(await requestScopeToken(request('1', new Headers()))).not.toBe(alpha)
	})

	it(`differs per user and says neither the user nor the tenant on ${db}`, async () => {
		const alpha = (await requestScopeToken(request('1', cookie('alpha')))) ?? ''
		expect(await requestScopeToken(request('2', cookie('alpha')))).not.toBe(alpha)
		expect(alpha).not.toContain('alpha')
		expect(alpha).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})

	// Every surface of one page asks: the view, each widget, each field, the panel.
	it(`resolves the scope once per request however many surfaces ask on ${db}`, async () => {
		const req = request('1', cookie('alpha'))
		const before = resolved
		const tokens = await Promise.all(Array.from({ length: 6 }, () => requestScopeToken(req)))
		expect(new Set(tokens).size).toBe(1)
		expect(resolved - before).toBe(1)
	})

	it(`answers no token for a request without a user on ${db}`, async () => {
		expect(
			await requestScopeToken(readerRequest(booted.payload, { user: null, headers: cookie('a') }))
		).toBeUndefined()
	})
})

describeForDb('request scope token, install without scope config', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: analytics({ adapters: [memoryAdapter()] }), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`answers one token per user whatever cookies the request carries on ${db}`, async () => {
		const as = (user: string, headers: Headers) =>
			requestScopeToken(
				readerRequest(booted.payload, {
					user: { id: user, collection: booted.payload.config.admin.user },
					headers,
				})
			)
		const first = await as('1', cookie('alpha'))
		expect(first).toEqual(expect.any(String))
		expect(await as('1', cookie('beta'))).toBe(first)
		expect(await as('2', cookie('alpha'))).not.toBe(first)
	})
})
