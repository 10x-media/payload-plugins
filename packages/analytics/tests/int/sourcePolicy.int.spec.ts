import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { AnalyticsAdapter } from '../../src/core/contract'
import type { SourcePolicy } from '../../src/core/sourcePolicy'
import { analytics } from '../../src/index'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import { memoryAdapter } from '../../src/testing/memoryAdapter'
import { callEndpoint } from './endpointHelpers'

const routes = routePaths(DEFAULT_ROUTE_BASE)
const PASSWORD = 'test-pass-1234'
const RANGE = 'from=2026-01-10&to=2026-01-16'

/** The admin collection: the first one with auth, so `admin.user` names it. */
const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	fields: [
		{ name: 'platform', type: 'checkbox' },
		{ name: 'tenant', type: 'text' },
	],
}

const pages: CollectionConfig = {
	slug: 'pages',
	access: { read: () => true },
	fields: [
		{ name: 'slug', type: 'text' },
		{ name: 'tenant', type: 'text' },
	],
}

type Reader = { platform?: boolean | null; tenant?: string | null } | null | undefined
const readerOf = (req: PayloadRequest): Reader => req.user as Reader

/** The platform's shared adapter, narrowing each query to one tenant; it records what it was asked. */
const sharedAdapter = (asked: Array<string | undefined>): AnalyticsAdapter => {
	const base = memoryAdapter()
	return {
		...base,
		id: 'shared',
		label: 'Platform',
		capabilities: { ...base.capabilities, scopedQueries: true },
		query: (query, ctx) => {
			asked.push(query.scope)
			return base.query(query, ctx)
		},
	}
}

const login = async (payload: Payload, email: string, data: Record<string, unknown>) => {
	await payload.create({ collection: 'users', data: { email, password: PASSWORD, ...data } })
	return (await payload.login({ collection: 'users', data: { email, password: PASSWORD } })).user
}

type SourcesBody = {
	defaultId: string | null
	sources: Array<{ id: string }>
	notice?: string
}
type ErrorBody = { error: { code: string } }

for (const policy of ['tenant', 'fallback'] as const satisfies readonly SourcePolicy[]) {
	describeForDb(`analytics source policy: sources.shared.tenants '${policy}'`, {}, (db) => {
		let booted: BootedPayload
		let alpha: unknown
		let betaPage: string
		const asked: Array<string | undefined> = []

		beforeAll(async () => {
			booted = await bootPayload({
				db,
				collections: [users, pages],
				plugin: analytics({
					adapters: [sharedAdapter(asked)],
					platformAdapter: 'shared',
					capture: { gate: 'off' },
					scope: {
						resolve: ({ req }) => readerOf(req)?.tenant ?? null,
						member: ({ req, scope }) =>
							readerOf(req)?.platform === true || readerOf(req)?.tenant === scope,
					},
					access: { crossScope: ({ req }) => readerOf(req)?.platform === true },
					sources: { shared: { tenants: policy } },
					providers: { collection: true },
					collections: { pages: { pathField: 'slug' } },
				}),
			})
			alpha = await login(booted.payload, 'alpha@t.dev', { tenant: 'alpha' })
			const page = await booted.payload.create({
				collection: 'pages' as never,
				data: { slug: 'about', tenant: 'beta' } as never,
			})
			betaPage = String((page as { id: string | number }).id)
		}, 240_000)

		afterAll(async () => {
			await booted?.stop()
		})

		const get = (path: string, query: string) =>
			callEndpoint(booted.payload, { path, query, user: alpha })

		const listing = async (): Promise<SourcesBody> => {
			const res = await get(routes.sources, '')
			expect(res.status).toBe(200)
			return (await res.json()) as SourcesBody
		}

		const codeOf = async (res: Response): Promise<string> =>
			((await res.json()) as ErrorBody).error.code

		it(`refuses a tenant member every scope and another tenant's on the query endpoint on ${db}`, async () => {
			for (const scope of ['*', 'beta']) {
				const res = await get(routes.query, `metrics=pageviews&${RANGE}&scope=${scope}`)
				expect(res.status).toBe(400)
				expect(await codeOf(res)).toBe('untrusted_scope')
			}
		})

		it(`refuses another tenant's document on the sources and document endpoints on ${db}`, async () => {
			const sources = await get(routes.sources, `collection=pages&id=${betaPage}`)
			expect(sources.status).toBe(400)
			expect(await codeOf(sources)).toBe('untrusted_scope')
			const document = await get(routes.document, `collection=pages&id=${betaPage}`)
			expect(document.status).toBe(400)
			expect(await codeOf(document)).toBe('untrusted_scope')
		})

		it(`narrows the member's read through the shared adapter to their tenant on ${db}`, async () => {
			asked.length = 0
			const res = await get(routes.query, `metrics=pageviews&${RANGE}&source=shared`)
			expect(res.status).toBe(200)
			expect(asked).toEqual(['alpha'])
		})

		if (policy === 'tenant') {
			it(`lists the shared adapter to a member without a notice on ${db}`, async () => {
				const body = await listing()
				expect(body.sources.map((source) => source.id)).toEqual(['shared'])
				expect(body.notice).toBeUndefined()
			})
		}

		if (policy === 'fallback') {
			// Each listing is a request of its own: nothing kept between them may hold the answer.
			it(`swaps the shared adapter for the tenant's own source as it is enabled and disabled on ${db}`, async () => {
				const alone = await listing()
				expect(alone.sources.map((source) => source.id)).toEqual(['shared'])
				expect(alone.defaultId).toBe('shared')
				expect(alone.notice).toBe('platformFallback')

				const doc = (await booted.payload.create({
					collection: PROVIDERS_SLUG as never,
					data: {
						name: 'Alpha Plausible',
						provider: 'plausible',
						enabled: true,
						plausible: { siteId: 'alpha.test', apiKey: 'alpha-plausible-key-1234' },
					} as never,
					user: alpha as never,
					overrideAccess: false,
				})) as unknown as { id: string | number }
				try {
					const owning = await listing()
					expect(owning.sources.map((source) => source.id)).toEqual([`plausible:${doc.id}`])
					expect(owning.defaultId).toBe(`plausible:${doc.id}`)
					expect(owning.notice).toBeUndefined()
					const refused = await get(routes.query, `metrics=pageviews&${RANGE}&source=shared`)
					expect(refused.status).toBe(404)

					await booted.payload.update({
						collection: PROVIDERS_SLUG as never,
						id: doc.id,
						data: { enabled: false } as never,
						user: alpha as never,
						overrideAccess: false,
					})
					const back = await listing()
					expect(back.sources.map((source) => source.id)).toEqual(['shared'])
					expect(back.notice).toBe('platformFallback')
				} finally {
					await booted.payload.delete({
						collection: PROVIDERS_SLUG as never,
						id: doc.id,
						overrideAccess: true,
					})
				}
			})
		}
	})
}
