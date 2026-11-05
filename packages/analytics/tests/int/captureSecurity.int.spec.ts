import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { type CollectionConfig, handleEndpoints, type Payload, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { tenantMembership } from '../../src/access/membership'
import { exclusionToken, exclusionTokenHash } from '../../src/capture/exclusionToken'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import type { TrackerConfig } from '../../src/tracker/config'
import type { ExclusionResponse } from '../../src/view/exclusionLink'
import { storedHits } from './nativeHelpers'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const VISITOR_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

type ErrorBody = { error: { code: string } }

const codeOf = async (res: Response): Promise<string> =>
	((await res.json()) as ErrorBody).error.code

describeForDb('analytics capture security: request trust', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off', allowedOrigins: ['https://partner.example'] },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const send = (
		path: string,
		init: { method?: string; headers?: Record<string, string>; body?: string } = {}
	): Promise<Response> =>
		handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://site.example/api${path}`, {
				method: init.method ?? 'GET',
				headers: { host: 'site.example', 'user-agent': VISITOR_UA, ...init.headers },
				...(init.body === undefined ? {} : { body: init.body }),
			}),
		})

	const beacon = (path: string, headers: Record<string, string>) =>
		send(routes.ingest, {
			method: 'POST',
			headers: { 'content-type': 'text/plain;charset=UTF-8', ...headers },
			body: JSON.stringify({ type: 'pageview', path }),
		})

	const stored = (path: string) => storedHits(booted.payload, { path: { equals: path } })

	it(`answers a cross-site beacon 202 and stores nothing on ${db}`, async () => {
		const res = await beacon('/cross-site', {
			'sec-fetch-site': 'cross-site',
			origin: 'https://evil.example',
		})
		expect(res.status).toBe(202)
		expect(await stored('/cross-site')).toEqual([])
	})

	it(`stores the same beacon from an allowed origin on ${db}`, async () => {
		const res = await beacon('/partner', {
			'sec-fetch-site': 'cross-site',
			origin: 'https://partner.example',
		})
		expect(res.status).toBe(202)
		expect(await stored('/partner')).toHaveLength(1)
	})

	it(`stores no country from a spoofed cf-ipcountry without trustedPlatform on ${db}`, async () => {
		const res = await beacon('/spoofed', {
			'sec-fetch-site': 'same-origin',
			'cf-ipcountry': 'KP',
			'x-vercel-ip-country': 'KP',
			'cf-connecting-ip': '203.0.113.9',
		})
		expect(res.status).toBe(202)
		const docs = await stored('/spoofed')
		expect(docs).toHaveLength(1)
		expect(docs[0]?.country ?? null).toBeNull()
	})

	it(`serves no exclusion link and mounts no exclusion endpoint while it is off on ${db}`, async () => {
		const config = (await (await send(routes.config)).json()) as TrackerConfig
		expect(config.exclusion).toBeUndefined()
		expect(
			booted.payload.config.endpoints.some((endpoint) => endpoint.path === routes.exclusion)
		).toBe(false)
	})
})

const tenants: CollectionConfig = {
	slug: 'tenants',
	fields: [{ name: 'domain', type: 'text', required: true }],
}

/** The admin collection: the first one with auth, so `admin.user` names it. */
const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	fields: [
		{ name: 'platform', type: 'checkbox' },
		{
			name: 'tenants',
			type: 'array',
			fields: [{ name: 'tenant', type: 'relationship', relationTo: 'tenants' }],
		},
	],
}

/** Shoppers who sign in to the site itself, never to the admin. */
const customers: CollectionConfig = { slug: 'customers', auth: true, fields: [] }

const TENANT_COOKIE = 'payload-tenant'

const cookieOf = (headers: Headers, name: string): string | null => {
	for (const part of (headers.get('cookie') ?? '').split(';')) {
		const [key, ...value] = part.trim().split('=')
		if (key === name) {
			return value.join('=') || null
		}
	}
	return null
}

/** The admin's tenant selector first, then the request's host, as a real host resolves it. */
const resolveTenant = async ({ req }: { req: PayloadRequest }): Promise<string | null> => {
	const selected = cookieOf(req.headers, TENANT_COOKIE)
	if (selected) {
		return selected
	}
	const host = req.headers.get('host')?.split(':')[0]
	if (!host) {
		return null
	}
	const { docs } = await req.payload.find({
		collection: 'tenants',
		where: { domain: { equals: host } },
		limit: 1,
		depth: 0,
		overrideAccess: true,
	})
	const tenant = docs[0]
	return tenant ? String(tenant.id) : null
}

const PASSWORD = 'test-pass-1234'

const login = async (
	payload: Payload,
	account: { collection: 'users' | 'customers'; email: string; data?: Record<string, unknown> }
) => {
	const { collection, email } = account
	await payload.create({ collection, data: { email, password: PASSWORD, ...account.data } })
	return payload.login({ collection, data: { email, password: PASSWORD } })
}

/** Each tenant's site is its own domain; the platform's own scope has none. */
const tenantSites = async ({
	req,
	scope,
}: {
	req: PayloadRequest
	scope: string | null
}): Promise<string[]> => {
	if (scope === null) {
		return []
	}
	const tenant = await req.payload.findByID({
		collection: 'tenants',
		id: scope,
		depth: 0,
		overrideAccess: true,
	})
	return typeof tenant.domain === 'string' ? [`https://${tenant.domain}`] : []
}

describeForDb('analytics capture security: exclusion endpoint', {}, (db) => {
	let booted: BootedPayload
	let alphaId: string
	let betaId: string
	let editor: Awaited<ReturnType<typeof login>>
	let platform: Awaited<ReturnType<typeof login>>
	let customer: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [tenants, users, customers],
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off', exclusion: { sites: tenantSites } },
				scope: {
					resolve: resolveTenant,
					member: tenantMembership({
						userHasAccessToAllTenants: (user) => user.platform === true,
					}),
					list: async ({ payload }) =>
						(await payload.find({ collection: 'tenants', depth: 0, pagination: false })).docs.map(
							(tenant) => String(tenant.id)
						),
				},
				access: { crossScope: ({ req }) => req.user?.platform === true },
			}),
		})
		const { payload } = booted
		const alpha = await payload.create({ collection: 'tenants', data: { domain: 'alpha.test' } })
		const beta = await payload.create({ collection: 'tenants', data: { domain: 'beta.test' } })
		alphaId = String(alpha.id)
		betaId = String(beta.id)
		platform = await login(payload, {
			collection: 'users',
			email: 'platform@t.dev',
			data: { platform: true },
		})
		editor = await login(payload, {
			collection: 'users',
			email: 'editor@alpha.test',
			data: { tenants: [{ tenant: alpha.id }] },
		})
		customer = await login(payload, { collection: 'customers', email: 'shopper@t.dev' })
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const call = (
		path: string,
		init: { token?: string; tenant?: string; host?: string } = {}
	): Promise<Response> => {
		const host = init.host ?? 'admin.test'
		const cookie = [
			init.token ? `payload-token=${init.token}` : '',
			init.tenant ? `${TENANT_COOKIE}=${init.tenant}` : '',
		]
			.filter((part) => part !== '')
			.join('; ')
		return handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://${host}/api${path}`, {
				headers: { host, 'user-agent': VISITOR_UA, ...(cookie ? { cookie } : {}) },
			}),
		})
	}

	it(`refuses an anonymous request on ${db}`, async () => {
		const res = await call(routes.exclusion)
		expect(res.status).toBe(401)
	})

	it(`refuses a user who is not an admin user on ${db}`, async () => {
		const res = await call(routes.exclusion, { token: customer.token, tenant: alphaId })
		expect(res.status).toBe(403)
		expect(await codeOf(res)).toBe('forbidden')
	})

	it(`refuses a user whose selector names a tenant they do not belong to on ${db}`, async () => {
		const res = await call(routes.exclusion, { token: editor.token, tenant: betaId })
		expect(res.status).toBe(400)
		expect(await codeOf(res)).toBe('untrusted_scope')
	})

	it(`refuses a member naming a foreign scope on ${db}`, async () => {
		const res = await call(`${routes.exclusion}?scope=${betaId}`, {
			token: editor.token,
			tenant: alphaId,
		})
		expect(res.status).toBe(400)
		expect(await codeOf(res)).toBe('untrusted_scope')
	})

	it(`answers a member their own tenant's token, which that tenant's tracker accepts, on ${db}`, async () => {
		const res = await call(routes.exclusion, { token: editor.token, tenant: alphaId })
		expect(res.status).toBe(200)
		expect(res.headers.get('cache-control')).toContain('no-store')
		const body = (await res.json()) as ExclusionResponse
		expect(body).toEqual({
			param: 'analytics_exclude',
			token: exclusionToken(booted.payload.secret, alphaId),
			sameOrigin: false,
			sites: [
				{
					address: 'https://alpha.test/',
					token: exclusionToken(booted.payload.secret, alphaId),
				},
			],
		})

		const alphaConfig = (await (
			await call(routes.config, { host: 'alpha.test' })
		).json()) as TrackerConfig
		const betaConfig = (await (
			await call(routes.config, { host: 'beta.test' })
		).json()) as TrackerConfig
		expect(alphaConfig.exclusion).toEqual({
			param: 'analytics_exclude',
			tokenHash: exclusionTokenHash(body.token),
		})
		expect(betaConfig.exclusion?.tokenHash).not.toBe(exclusionTokenHash(body.token))
		expect(JSON.stringify(alphaConfig)).not.toContain(body.token)
	})

	it(`offers the switch to an admin served from the tenant's own site on ${db}`, async () => {
		const res = await call(routes.exclusion, {
			token: editor.token,
			tenant: alphaId,
			host: 'alpha.test',
		})
		expect(((await res.json()) as ExclusionResponse).sameOrigin).toBe(true)
	})

	it(`lets a crossScope reader name another tenant on ${db}`, async () => {
		const res = await call(`${routes.exclusion}?scope=${betaId}`, {
			token: platform.token,
			tenant: alphaId,
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as ExclusionResponse
		expect(body.token).toBe(exclusionToken(booted.payload.secret, betaId))
		// The sites are the named scope's, never the reader's own selection.
		expect(body.sites).toEqual([{ address: 'https://beta.test/', token: body.token }])
	})

	it(`answers every tenant's sites with its own token on the all-sites view on ${db}`, async () => {
		const res = await call(routes.exclusion, { token: platform.token })
		expect(res.status).toBe(200)
		const body = (await res.json()) as ExclusionResponse
		expect(body.token).toBe(exclusionToken(booted.payload.secret, null))
		expect(body.sites).toEqual(
			expect.arrayContaining([
				{ address: 'https://alpha.test/', token: exclusionToken(booted.payload.secret, alphaId) },
				{ address: 'https://beta.test/', token: exclusionToken(booted.payload.secret, betaId) },
			])
		)
		expect(body.sites).toHaveLength(2)
	})
})
