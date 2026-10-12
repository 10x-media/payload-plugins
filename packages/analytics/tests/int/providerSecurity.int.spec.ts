import { decryptFieldValue, withRawEncrypted } from '@10x-media/fields/encrypted'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import {
	type CollectionConfig,
	createLocalReq,
	handleEndpoints,
	type Payload,
	type PayloadRequest,
} from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { tenantMembership } from '../../src/access/membership'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { DEFAULT_ROUTE_BASE, routePaths } from '../../src/plugin/routes'
import { PROVIDERS_SLUG } from '../../src/providers/collection'
import type { TrackerConfig } from '../../src/tracker/config'

const routes = routePaths(DEFAULT_ROUTE_BASE)

const TENANT_COOKIE = 'payload-tenant'
const PASSWORD = 'test-pass-1234'
const RANGE = 'from=2026-01-10&to=2026-01-16'

const ALLOWED = 'https://plausible.alpha.test'
const ALSO_ALLOWED = 'https://stats.alpha.test'
const UNLISTED = 'https://plausible.unlisted.test'

/** `sourceAccess` leaves this document out of every reader's sources. */
const HIDDEN = 'Hidden from readers'

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

const cookieOf = (headers: Headers, name: string): string | null => {
	for (const part of (headers.get('cookie') ?? '').split(';')) {
		const [key, ...value] = part.trim().split('=')
		if (key === name) {
			return value.join('=') || null
		}
	}
	return null
}

/** The admin's tenant selector first, the site a visit landed on after it. */
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

const isPlatform = ({ req }: { req: PayloadRequest }): boolean => req.user?.platform === true

/** Signs a user in; Payload stamps the result's user with the collection it signed in through. */
const login = async (
	payload: Payload,
	account: { collection: 'users' | 'customers'; email: string; data?: Record<string, unknown> }
) => {
	const { collection, email } = account
	await payload.create({ collection, data: { email, password: PASSWORD, ...account.data } })
	return payload.login({ collection, data: { email, password: PASSWORD } })
}

type Login = Awaited<ReturnType<typeof login>>

type PlausibleGroup = {
	siteId?: string | null
	host?: string | null
	apiKey?: string | null
	apiKey_hint?: string | null
}

type UmamiGroup = { websiteId?: string | null; apiKey?: string | null }

type ProviderRow = {
	id: string | number
	name?: string
	provider?: string
	plausible?: PlausibleGroup | null
	umami?: UmamiGroup | null
}

describeForDb('analytics provider security: hosts, retargeting and access', {}, (db) => {
	let booted: BootedPayload
	let alphaId: string
	let betaId: string
	let platform: Login
	let editor: Login
	let customer: Login
	let alphaDoc: ProviderRow
	let hiddenDoc: ProviderRow
	let betaDoc: ProviderRow

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			collections: [tenants, users, customers],
			plugin: analytics({
				adapters: [native()],
				capture: { gate: 'off' },
				scope: {
					resolve: resolveTenant,
					member: tenantMembership({ userHasAccessToAllTenants: (user) => user.platform === true }),
				},
				access: { crossScope: isPlatform },
				providers: {
					hosts: { allow: [ALLOWED, ALSO_ALLOWED] },
					collection: {
						// Only platform staff may open the providers collection at all; readers still read
						// through the documents sourceAccess lets them.
						access: { read: isPlatform },
						sourceAccess: ({ req }) => (req.user ? { name: { not_equals: HIDDEN } } : false),
					},
				},
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
		const create = async (data: Record<string, unknown>): Promise<ProviderRow> =>
			(await payload.create({
				collection: PROVIDERS_SLUG,
				data: { enabled: true, provider: 'plausible', ...data },
				user: platform.user,
				overrideAccess: false,
			})) as unknown as ProviderRow
		alphaDoc = await create({
			name: 'Alpha Plausible',
			scope: alphaId,
			plausible: {
				siteId: 'alpha.test',
				apiKey: 'alpha-plausible-key-1234',
				host: ALLOWED,
				domain: 'alpha.test',
			},
		})
		hiddenDoc = await create({
			name: HIDDEN,
			scope: alphaId,
			plausible: { siteId: 'hidden.test', apiKey: 'hidden-plausible-key-0000' },
		})
		betaDoc = await create({
			name: 'Beta Plausible',
			scope: betaId,
			plausible: {
				siteId: 'beta.test',
				apiKey: 'beta-plausible-key-5678',
				host: UNLISTED,
				domain: 'beta.test',
			},
		})
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
				headers: { host, ...(cookie ? { cookie } : {}) },
			}),
		})
	}

	/** The stored document as it sits in the database, ciphertext included. */
	const stored = async (id: string | number): Promise<ProviderRow> => {
		const req = await createLocalReq({}, booted.payload)
		return (await withRawEncrypted(req, () =>
			booted.payload.findByID({ collection: PROVIDERS_SLUG, id, req, overrideAccess: true })
		)) as unknown as ProviderRow
	}

	const plaintext = async (path: string, value: string | null | undefined): Promise<unknown> =>
		value ? decryptFieldValue(booted.payload, { collection: PROVIDERS_SLUG, path, value }) : value

	/** A Local API request with the admin's tenant selector set, which `scope.resolve` reads. */
	const selecting = (tenant: string | undefined) =>
		tenant ? { req: { headers: new Headers({ cookie: `${TENANT_COOKIE}=${tenant}` }) } } : {}

	const update = (
		who: Login,
		change: { id: string | number; data: Record<string, unknown>; tenant?: string }
	): Promise<ProviderRow> =>
		booted.payload.update({
			collection: PROVIDERS_SLUG,
			id: change.id,
			data: change.data,
			user: who.user,
			overrideAccess: false,
			...selecting(change.tenant),
		}) as unknown as Promise<ProviderRow>

	const updateAs = (who: Login, id: string | number, data: Record<string, unknown>) =>
		update(who, { id, data })

	/** An update from someone who has alpha selected in the admin's tenant selector. */
	const updateInAlpha = (who: Login, id: string | number, data: Record<string, unknown>) =>
		update(who, { id, data, tenant: alphaId })

	it(`answers source_misconfigured for an unlisted host's source on ${db}`, async () => {
		const listing = await call(routes.sources, { token: platform.token, tenant: betaId })
		const { sources } = (await listing.json()) as { sources: Array<{ id: string }> }
		expect(sources.map((source) => source.id)).toContain(`plausible:${betaDoc.id}`)

		const res = await call(
			`${routes.query}?source=plausible:${betaDoc.id}&metrics=pageviews&${RANGE}`,
			{ token: platform.token, tenant: betaId }
		)
		expect(res.status).toBe(502)
		const body = (await res.json()) as { error: { code: string; param?: string; message: string } }
		expect(body.error.code).toBe('source_misconfigured')
		expect(body.error.param).toBe('host')
		expect(body.error.message).toContain('providers.hosts.allow')
		expect(body.error.message).not.toContain('unlisted')
	})

	it(`refuses the capture slot of an unlisted host and fills a listed one on ${db}`, async () => {
		const configFor = async (host: string): Promise<TrackerConfig> =>
			(await (await call(routes.config, { host })).json()) as TrackerConfig
		const alpha = await configFor('alpha.test')
		expect(alpha.slots.find((slot) => slot.slot === 'tenant')).toMatchObject({
			kind: 'plausible',
			adapterId: `plausible:${alphaDoc.id}`,
		})
		const beta = await configFor('beta.test')
		expect(beta.slots.find((slot) => slot.slot === 'tenant')).toBeUndefined()
		const proxied = await call(`${routes.proxy}/tenant/js/script.js`, { host: 'beta.test' })
		expect(proxied.status).toBe(404)
	})

	it(`clears the key and its hint when the site id changes without it on ${db}`, async () => {
		const doc = await updateAs(platform, alphaDoc.id, {
			plausible: { siteId: 'alpha-renamed.test' },
		})
		expect(doc.plausible?.siteId).toBe('alpha-renamed.test')
		const row = await stored(alphaDoc.id)
		expect(row.plausible?.apiKey ?? null).toBeNull()
		expect(row.plausible?.apiKey_hint ?? null).toBeNull()
	})

	it(`keeps a key sent again with the new connection on ${db}`, async () => {
		await updateAs(platform, alphaDoc.id, {
			plausible: { host: ALSO_ALLOWED, apiKey: 'alpha-replacement-key-9876' },
		})
		const row = await stored(alphaDoc.id)
		expect(row.plausible?.host).toBe(ALSO_ALLOWED)
		expect(row.plausible?.apiKey).toMatch(/^pfe1\./)
		expect(row.plausible?.apiKey_hint).toBe('····9876')
		expect(await plaintext('plausible.apiKey', row.plausible?.apiKey)).toBe(
			'alpha-replacement-key-9876'
		)
	})

	it(`clears the key when the host changes without it on ${db}`, async () => {
		await updateAs(platform, alphaDoc.id, { plausible: { host: ALLOWED } })
		const row = await stored(alphaDoc.id)
		expect(row.plausible?.host).toBe(ALLOWED)
		expect(row.plausible?.apiKey ?? null).toBeNull()
		expect(row.plausible?.apiKey_hint ?? null).toBeNull()
		await updateAs(platform, alphaDoc.id, {
			plausible: { apiKey: 'alpha-plausible-key-1234' },
		})
	})

	it(`keeps the key through a save that changes nothing it connects with on ${db}`, async () => {
		await updateAs(platform, alphaDoc.id, { name: 'Alpha Plausible, renamed' })
		const row = await stored(alphaDoc.id)
		expect(await plaintext('plausible.apiKey', row.plausible?.apiKey)).toBe(
			'alpha-plausible-key-1234'
		)
	})

	it(`clears the other provider's key when the provider changes on ${db}`, async () => {
		const doc = (await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: {
				name: 'Switching',
				provider: 'plausible',
				enabled: false,
				scope: alphaId,
				plausible: { siteId: 'switch.test', apiKey: 'switch-plausible-key-4321' },
			},
			user: platform.user,
			overrideAccess: false,
		})) as unknown as ProviderRow
		await updateAs(platform, doc.id, {
			provider: 'umami',
			umami: { websiteId: 'w-1', apiKey: 'switch-umami-key-2468' },
		})
		const row = await stored(doc.id)
		expect(row.provider).toBe('umami')
		expect(row.plausible?.apiKey ?? null).toBeNull()
		expect(await plaintext('umami.apiKey', row.umami?.apiKey)).toBe('switch-umami-key-2468')
	})

	it(`clears the keys of every document a bulk update retargets on ${db}`, async () => {
		const ids: Array<string | number> = []
		for (const name of ['Bulk one', 'Bulk two']) {
			const doc = (await booted.payload.create({
				collection: PROVIDERS_SLUG,
				data: {
					name,
					provider: 'plausible',
					enabled: false,
					scope: alphaId,
					plausible: { siteId: `${name}.test`, apiKey: `${name}-plausible-key-1357` },
				},
				user: platform.user,
				overrideAccess: false,
			})) as unknown as ProviderRow
			ids.push(doc.id)
		}
		await booted.payload.update({
			collection: PROVIDERS_SLUG,
			where: { id: { in: ids } },
			data: { plausible: { siteId: 'bulk.test' } },
			overrideAccess: true,
		})
		for (const id of ids) {
			const row = await stored(id)
			expect(row.plausible?.siteId).toBe('bulk.test')
			expect(row.plausible?.apiKey ?? null).toBeNull()
		}
	})

	it(`ignores a tenant editor's connection change on ${db}`, async () => {
		const before = await stored(alphaDoc.id)
		const doc = await updateInAlpha(editor, alphaDoc.id, {
			name: 'Alpha, edited by its tenant',
			plausible: { siteId: 'hijacked.test', host: ALSO_ALLOWED },
		})
		expect(doc.name).toBe('Alpha, edited by its tenant')
		const row = await stored(alphaDoc.id)
		expect(row.plausible?.siteId).toBe(before.plausible?.siteId)
		expect(row.plausible?.host).toBe(before.plausible?.host)
		expect(row.plausible?.apiKey).toBe(before.plausible?.apiKey)
		expect(row.plausible?.apiKey_hint).toBe(before.plausible?.apiKey_hint)
		expect(await plaintext('plausible.apiKey', row.plausible?.apiKey)).toBe(
			'alpha-plausible-key-1234'
		)
	})

	it(`lets the tenant editor set a connection on a document they create on ${db}`, async () => {
		const doc = (await booted.payload.create({
			collection: PROVIDERS_SLUG,
			data: {
				name: 'Alpha, by its editor',
				provider: 'plausible',
				enabled: false,
				plausible: { siteId: 'editor.test', apiKey: 'editor-plausible-key-8642', host: ALLOWED },
			},
			user: editor.user,
			overrideAccess: false,
			...selecting(alphaId),
		})) as unknown as ProviderRow & { scope?: string }
		expect(doc.scope).toBe(alphaId)
		const row = await stored(doc.id)
		expect(row.plausible?.siteId).toBe('editor.test')
		expect(row.plausible?.host).toBe(ALLOWED)
	})

	it(`refuses every provider write from a user outside the admin collection on ${db}`, async () => {
		await expect(
			booted.payload.create({
				collection: PROVIDERS_SLUG,
				data: { name: 'Shopper', provider: 'native', enabled: true, scope: alphaId },
				user: customer.user,
				overrideAccess: false,
				...selecting(alphaId),
			})
		).rejects.toThrow()
		await expect(
			updateInAlpha(customer, alphaDoc.id, { name: 'Shopper was here' })
		).rejects.toThrow()
		expect((await stored(alphaDoc.id)).name).not.toBe('Shopper was here')
	})

	it(`refuses a host that is not an https address at save time on ${db}`, async () => {
		for (const host of ['http://plausible.alpha.test', `${ALLOWED}/?site=alpha`]) {
			await expect(updateAs(platform, alphaDoc.id, { plausible: { host } })).rejects.toThrow()
		}
		expect((await stored(alphaDoc.id)).plausible?.host).toBe(ALLOWED)
	})

	it(`lists the sources sourceAccess allows that the collection hides on ${db}`, async () => {
		await expect(
			booted.payload.find({
				collection: PROVIDERS_SLUG,
				user: editor.user,
				overrideAccess: false,
			})
		).rejects.toThrow()
		const res = await call(routes.sources, { token: editor.token, tenant: alphaId })
		expect(res.status).toBe(200)
		const { sources } = (await res.json()) as { sources: Array<{ id: string }> }
		const ids = sources.map((source) => source.id)
		expect(ids).toContain(`plausible:${alphaDoc.id}`)
		expect(ids).not.toContain(`plausible:${hiddenDoc.id}`)
		expect(ids).not.toContain(`plausible:${betaDoc.id}`)
	})
})
