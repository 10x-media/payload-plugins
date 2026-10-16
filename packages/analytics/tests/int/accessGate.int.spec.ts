import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import {
	type CollectionConfig,
	createLocalReq,
	handleEndpoints,
	type Payload,
	type PayloadRequest,
	type TypedUser,
} from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { tenantMembership } from '../../src/access/membership'
import { DEFAULT_JOBS } from '../../src/core/jobs'
import { readForField } from '../../src/fields/readForDocument'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { GoalsResponse } from '../../src/goals/fetchGoals'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { getRuntime } from '../../src/plugin/runtime'
import { warmTask } from '../../src/plugin/warmTask'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import type { TrackerConfig } from '../../src/tracker/config'
import { readForWidget } from '../../src/widgets/readForWidget'
import { storedHits } from './nativeHelpers'

const routes = routePaths(DEFAULT_ROUTE_BASE)

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

const pages: CollectionConfig = { slug: 'pages', fields: [{ name: 'slug', type: 'text' }] }

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

/** What every capture call site handed the resolver, to check nobody's identity got through. */
const captured: Array<{ user: unknown; cookie: string | null; authorization: string | null }> = []

/**
 * Shaped like a real host's resolver: admin's tenant selector cookie first, request host after.
 * Ignores call site on purpose: stripping identity from a capture is the plugin's job.
 */
const resolveTenant = async ({
	req,
	callSite,
}: {
	req: PayloadRequest
	callSite: 'capture' | 'admin'
}): Promise<string | null> => {
	if (callSite === 'capture') {
		captured.push({
			user: req.user,
			cookie: req.headers.get('cookie'),
			authorization: req.headers.get('authorization'),
		})
	}
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

const isPlatform = ({ req }: { req: PayloadRequest }): boolean => req.user?.platform === true

const PASSWORD = 'test-pass-1234'

const login = async (
	payload: Payload,
	account: { collection: 'users' | 'customers'; email: string; data?: Record<string, unknown> }
) => {
	const { collection, email } = account
	await payload.create({ collection, data: { email, password: PASSWORD, ...account.data } })
	return payload.login({ collection, data: { email, password: PASSWORD } })
}

type ErrorBody = { error: { code: string; param?: string } }

const RANGE = 'from=2026-01-10&to=2026-01-16'

describeForDb('analytics access: read gate, membership and capture identity', {}, (db) => {
	const nativeAdapter = native()
	let booted: BootedPayload
	let alphaId: string
	let betaId: string
	let editor: Awaited<ReturnType<typeof login>>
	let platform: Awaited<ReturnType<typeof login>>
	let customer: Awaited<ReturnType<typeof login>>
	let page: { id: string | number; slug: string }

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [tenants, users, customers, pages],
			plugin: analytics({
				adapters: [nativeAdapter],
				capture: { gate: 'off' },
				collections: { pages: { pathField: 'slug', scopeField: false } },
				goals: { collection: true },
				providers: { collection: true },
				scope: {
					resolve: resolveTenant,
					member: tenantMembership({ userHasAccessToAllTenants: (user) => user.platform === true }),
				},
				access: { crossScope: isPlatform },
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
		for (const [scope, name] of [
			[alphaId, 'alpha'],
			[betaId, 'beta'],
		] as const) {
			// A tenant stores and reads its visits through its own `native` document.
			await payload.create({
				collection: PROVIDERS_SLUG,
				data: { name: `${name} site`, provider: 'native', enabled: true, scope },
				user: platform.user,
				overrideAccess: false,
			})
			await payload.create({
				collection: GOALS_SLUG,
				data: { name: `${name} signup`, slug: `${name}-signup`, match: { kind: 'goal' }, scope },
				user: platform.user,
				overrideAccess: false,
			})
		}
		const created = await payload.create({ collection: 'pages', data: { slug: 'home' } })
		page = { id: created.id, slug: 'home' }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const cookieFor = (token: string | undefined, tenant?: string): string =>
		[token ? `payload-token=${token}` : '', tenant ? `${TENANT_COOKIE}=${tenant}` : '']
			.filter((part) => part !== '')
			.join('; ')

	const call = (
		path: string,
		init: { token?: string; tenant?: string; host?: string; method?: string; body?: string } = {}
	): Promise<Response> => {
		const host = init.host ?? 'admin.test'
		const cookie = cookieFor(init.token, init.tenant)
		return handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`http://${host}/api${path}`, {
				method: init.method ?? 'GET',
				headers: {
					host,
					'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
					...(cookie ? { cookie } : {}),
					...(init.body ? { 'content-type': 'application/json' } : {}),
				},
				...(init.body ? { body: init.body } : {}),
			}),
		})
	}

	const codeOf = async (res: Response): Promise<string> =>
		((await res.json()) as ErrorBody).error.code

	/** A server-rendered read (a widget, a display field) by one signed-in user. */
	const readerReq = (
		user: Awaited<ReturnType<typeof login>>['user'],
		collection: 'users' | 'customers',
		tenant?: string
	): PayloadRequest =>
		({
			payload: booted.payload,
			user: { ...user, collection },
			headers: new Headers(tenant ? { cookie: `${TENANT_COOKIE}=${tenant}` } : {}),
			locale: undefined,
		}) as unknown as PayloadRequest

	const widgetRead = (req: PayloadRequest) =>
		readForWidget({ req, metrics: ['pageviews'], timeframe: 'last7days', now: new Date() })

	const fieldRead = (req: PayloadRequest) =>
		readForField({
			req,
			collectionSlug: 'pages',
			data: page,
			metrics: ['pageviews'],
			timeframe: 'last7days',
			now: new Date(),
		})

	it(`denies a user of a second auth collection on the query endpoint on ${db}`, async () => {
		const res = await call(`${routes.query}?metrics=pageviews&${RANGE}`, {
			token: customer.token,
		})
		expect(res.status).toBe(403)
		expect(await codeOf(res)).toBe('forbidden')
		const member = await call(`${routes.query}?metrics=pageviews&${RANGE}`, {
			token: editor.token,
			tenant: alphaId,
		})
		expect(member.status).toBe(200)
	})

	it(`shows that user a widget's no-access state rather than numbers on ${db}`, async () => {
		expect((await widgetRead(readerReq(customer.user, 'customers', alphaId))).status).toBe(
			'no-access'
		)
		expect((await widgetRead(readerReq(editor.user, 'users', alphaId))).status).toBe('ok')
	})

	it(`shows that user a display field's no-access state on ${db}`, async () => {
		expect((await fieldRead(readerReq(customer.user, 'customers', alphaId))).status).toBe(
			'no-access'
		)
		expect((await fieldRead(readerReq(editor.user, 'users', alphaId))).status).not.toBe('no-access')
	})

	it(`refuses a member of one tenant naming another, or every tenant on ${db}`, async () => {
		for (const scope of [betaId, '*']) {
			const res = await call(`${routes.query}?metrics=pageviews&${RANGE}&scope=${scope}`, {
				token: editor.token,
				tenant: alphaId,
			})
			expect(res.status).toBe(400)
			expect(await codeOf(res)).toBe('untrusted_scope')
		}
	})

	it(`lets a crossScope reader name another tenant and every tenant on ${db}`, async () => {
		for (const scope of [betaId, '*']) {
			const res = await call(`${routes.query}?metrics=pageviews&${RANGE}&scope=${scope}`, {
				token: platform.token,
				tenant: alphaId,
			})
			expect(res.status).toBe(200)
		}
	})

	// The selector cookie is set in the browser: pointing it at a tenant is selecting it, and
	// belonging to it is a different question every read asks.
	it(`refuses a user whose selector names a tenant they do not belong to on ${db}`, async () => {
		const res = await call(`${routes.query}?metrics=pageviews&${RANGE}`, {
			token: editor.token,
			tenant: betaId,
		})
		expect(res.status).toBe(400)
		expect(await codeOf(res)).toBe('untrusted_scope')
		const sources = await call(routes.sources, { token: editor.token, tenant: betaId })
		expect(((await sources.json()) as { sources: unknown[] }).sources).toEqual([])
		expect((await widgetRead(readerReq(editor.user, 'users', betaId))).status).toBe('no-access')
	})

	it(`keeps that user out of the selected tenant's providers on ${db}`, async () => {
		const asEditor = async (tenant: string) =>
			booted.payload.find({
				collection: PROVIDERS_SLUG,
				overrideAccess: false,
				disableErrors: true,
				req: await createLocalReq(
					{
						req: { headers: new Headers({ cookie: `${TENANT_COOKIE}=${tenant}` }) },
						user: { ...editor.user, collection: 'users' } as TypedUser,
					},
					booted.payload
				),
			})
		expect((await asEditor(betaId)).docs).toEqual([])
		const own = await asEditor(alphaId)
		expect(own.docs.map((doc) => (doc as { scope?: string }).scope)).toEqual([alphaId])
	})

	it(`refuses a foreign scope on the goals endpoint on ${db}`, async () => {
		const foreign = await call(routes.goals, { token: editor.token, tenant: betaId })
		expect(foreign.status).toBe(400)
		expect(await codeOf(foreign)).toBe('untrusted_scope')

		const own = await call(routes.goals, { token: editor.token, tenant: alphaId })
		expect(own.status).toBe(200)
		const ownSlugs = ((await own.json()) as GoalsResponse).goals.map((goal) => goal.slug)
		expect(ownSlugs).toContain('alpha-signup')
		expect(ownSlugs).not.toContain('beta-signup')

		const staff = await call(routes.goals, { token: platform.token, tenant: betaId })
		const staffSlugs = ((await staff.json()) as GoalsResponse).goals.map((goal) => goal.slug)
		expect(staffSlugs).toContain('beta-signup')
		expect(staffSlugs).not.toContain('alpha-signup')
	})

	// Payload signs every API request in, so an editor's own beacon carries their session; a
	// resolver preferring the selector must not file it under their selected tenant.
	it(`stores a beacon sent with an editor's session under the host's tenant on ${db}`, async () => {
		captured.length = 0
		const res = await call(routes.ingest, {
			method: 'POST',
			host: 'beta.test',
			token: editor.token,
			tenant: alphaId,
			body: JSON.stringify({ type: 'pageview', path: '/from-an-editor' }),
		})
		expect(res.status).toBe(202)
		const docs = await storedHits(booted.payload, { path: { equals: '/from-an-editor' } })
		expect(docs.map((doc) => doc.scope)).toEqual([betaId])
		expect(captured.length).toBeGreaterThan(0)
		expect(captured.every((seen) => seen.user === null && seen.cookie === null)).toBe(true)
		expect(captured.every((seen) => seen.authorization === null)).toBe(true)
	})

	it(`serves the tracker config of the host's tenant to a signed-in editor on ${db}`, async () => {
		const res = await call(routes.config, {
			host: 'beta.test',
			token: editor.token,
			tenant: alphaId,
		})
		const config = (await res.json()) as TrackerConfig
		const slugs = config.goals.map((goal) => goal.slug)
		expect(slugs).toContain('beta-signup')
		expect(slugs).not.toContain('alpha-signup')
	})

	// A job has no user, so per-user narrowing of provider documents would hide every tenant's
	// source from it; as SYSTEM it reads each tenant through what that tenant owns.
	it(`warms every tenant's own provider-backed source as SYSTEM on ${db}`, async () => {
		const runtime = getRuntime(booted.payload)
		const refresh = runtime?.engine.refresh
		if (!runtime || !refresh) {
			throw new Error('runtime missing')
		}
		// Each tenant's own reader asks for the dashboard once, which records how to read it again.
		expect((await widgetRead(readerReq(editor.user, 'users', alphaId))).status).toBe('ok')
		expect((await widgetRead(readerReq(platform.user, 'users', betaId))).status).toBe('ok')
		const jobReq = await createLocalReq({}, booted.payload)
		expect((await widgetRead(jobReq)).status).toBe('no-access')
		// A read stores its entry, and the recipe the warm task replays, in the background.
		await runtime.engine.idle?.()

		const seen: Array<[string, string | undefined]> = []
		runtime.engine.refresh = (adapter, query, options) => {
			seen.push([adapter.id, query.scope])
			return refresh.call(runtime.engine, adapter, query, options)
		}
		try {
			const handler = warmTask({
				schedule: DEFAULT_JOBS.warm,
				windowHours: 24,
				maxReads: 200,
			}).handler
			if (typeof handler !== 'function') {
				throw new Error('warm task handler must be a function')
			}
			const result = await handler({ req: jobReq } as unknown as Parameters<typeof handler>[0])
			expect(result).toMatchObject({ output: { ran: true, failed: 0, skipped: 0 } })
			expect(seen).toContainEqual(['native', alphaId])
			expect(seen).toContainEqual(['native', betaId])
		} finally {
			runtime.engine.refresh = refresh
		}
	})
})
