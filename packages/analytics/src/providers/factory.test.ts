import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsQuery } from '../core/contract'
import type { FetchInit, FetchLike } from '../core/fetch'
import type { Ga4Sdk } from '../core/sdks'
import {
	isHostRefused,
	isSourceMisconfigured,
	SourceMisconfiguredError,
} from '../core/sourceErrors'
import { memoryAdapter } from '../testing/memoryAdapter'
import {
	adapterFromProviderDoc,
	normalizePrivateKey,
	type ProviderDoc,
	type ProviderFactoryContext,
} from './factory'
import { DEFAULT_HOST_POLICY, resolveHostPolicy } from './hosts'

/** The context every document adapter is built with: a fetch, and the vendors' clouds alone. */
const guarded: ProviderFactoryContext = {
	fetch: async () => Response.json({}),
	hosts: DEFAULT_HOST_POLICY,
}

const build = (doc: ProviderDoc, extra: Partial<ProviderFactoryContext> = {}) =>
	adapterFromProviderDoc(doc, { ...guarded, ...extra })

describe('adapterFromProviderDoc native', () => {
	const native = { ...memoryAdapter(), id: 'native', label: 'Payload' }

	// A native document configures no credentials; it grants the adapter the install already
	// registered, and it must keep that adapter's own id so the registry recognizes the grant.
	it('grants the install config native adapter under the document name', () => {
		const adapter = build({ id: 'doc7', provider: 'native', name: 'Alpha' }, { native })
		expect(adapter?.id).toBe('native')
		expect(adapter?.label).toBe('Alpha')
		expect(adapter?.query).toBe(native.query)
	})

	it('keeps the config label when the document names nothing', () => {
		const adapter = build({ id: 'doc7', provider: 'native' }, { native })
		expect(adapter).toBe(native)
	})

	it('builds nothing when the install registered no native adapter', () => {
		expect(build({ id: 'doc7', provider: 'native' })).toBeNull()
	})
})

describe('adapterFromProviderDoc', () => {
	it('builds a configured plausible adapter from a complete doc', () => {
		const adapter = build({
			provider: 'plausible',
			plausible: { siteId: 'example.com', apiKey: 'key' },
		})
		expect(adapter?.id).toBe('plausible')
		expect(adapter?.isConfigured()).toBe(true)
	})

	it('builds an unconfigured adapter when credentials are missing', () => {
		const adapter = build({ provider: 'plausible', plausible: {} })
		expect(adapter?.id).toBe('plausible')
		expect(adapter?.isConfigured()).toBe(false)
	})

	it('builds umami from either apiKey or token', () => {
		const cloud = build({
			provider: 'umami',
			umami: { websiteId: 'w', apiKey: 'k' },
		})
		expect(cloud?.isConfigured()).toBe(true)
		const selfHosted = build(
			{
				provider: 'umami',
				umami: { websiteId: 'w', token: 't', host: 'https://self.test' },
			},
			{ hosts: resolveHostPolicy({ allow: ['https://self.test'] }) }
		)
		expect(selfHosted?.isConfigured()).toBe(true)
	})

	it('builds ga4 with normalized credentials', () => {
		const adapter = build({
			provider: 'ga4',
			ga4: { propertyId: '123', clientEmail: 'svc@x.iam', privateKey: 'line1\\nline2' },
		})
		expect(adapter?.id).toBe('ga4')
		expect(adapter?.isConfigured()).toBe(true)
	})

	it('builds posthog from projectId and apiKey', () => {
		const adapter = build({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'phx_x' },
		})
		expect(adapter?.id).toBe('posthog')
		expect(adapter?.isConfigured()).toBe(true)
	})

	// Capture is declared only from public config, so these fields are what let a provider
	// document fill a tenant capture slot at all.
	it('passes the public posthog capture fields through to the adapter', () => {
		const adapter = build({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'phx_x', projectToken: 'phc_public', region: 'eu' },
		})
		expect(adapter?.capture?.client).toEqual({ kind: 'posthog', token: 'phc_public' })
		expect(adapter?.capture?.proxy.routes[0]?.upstream).toBe(
			'https://eu-assets.i.posthog.com/static/:p*'
		)
	})

	// Without this the adapter supports scoped reads and the document has no way to say so,
	// so a provider-document PostHog can never serve one tenant's slice of a shared project.
	it('threads the posthog scope property through, which turns scoped queries on', () => {
		const adapter = build({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'phx_x', scopeProperty: ' tenant ' },
		})
		expect(adapter?.capabilities.scopedQueries).toBe(true)
	})

	it('leaves scoped queries off for a blank scope property', () => {
		const adapter = build({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'phx_x', scopeProperty: '   ' },
		})
		expect(adapter?.capabilities.scopedQueries).toBeUndefined()
	})

	it('registers the resolved scope as a super-property in the capture snippet', () => {
		const adapter = build({
			provider: 'posthog',
			posthog: {
				projectId: '1',
				apiKey: 'phx_x',
				projectToken: 'phc_public',
				scopeProperty: 'tenant',
			},
		})
		const inline = adapter?.capture?.snippet({ path: '/ph', scope: 'alpha' }).scripts[0]?.inline
		expect(inline).toContain('posthog.register({["tenant"]:"alpha"})')
	})

	it('declares no posthog capture when the document carries no projectToken', () => {
		const adapter = build({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'phx_x' },
		})
		expect(adapter?.capture).toBeUndefined()
	})

	it('passes the public plausible capture fields through to the adapter', () => {
		const domain = build({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k', domain: 'site.test' },
		})
		expect(domain?.capture?.snippet({ path: '/pl' }).scripts[0]?.attrs).toEqual({
			'data-domain': 'site.test',
			'data-api': '/pl/api/event',
		})
		const scripted = build({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k', scriptId: 'abc123' },
		})
		expect(scripted?.capture?.snippet({ path: '/pl' }).scripts[0]?.src).toBe('/pl/js/pa-abc123.js')
	})

	it('declares no plausible capture without a domain or scriptId', () => {
		const adapter = build({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k' },
		})
		expect(adapter?.capture).toBeUndefined()
	})

	it('passes the ga4 measurementId through to the adapter', () => {
		const adapter = build({
			provider: 'ga4',
			ga4: {
				propertyId: '1',
				clientEmail: 'svc@x.iam',
				privateKey: 'pk',
				measurementId: 'G-XYZ789',
			},
		})
		expect(adapter?.capture?.client).toEqual({ kind: 'ga4', measurementId: 'G-XYZ789' })
		expect(adapter?.capture?.snippet({ path: '/ga' }).scripts[1]?.src).toBe(
			'https://www.googletagmanager.com/gtag/js?id=G-XYZ789'
		)
	})

	it('declares no ga4 capture without a measurementId', () => {
		const adapter = build({
			provider: 'ga4',
			ga4: { propertyId: '1', clientEmail: 'svc@x.iam', privateKey: 'pk' },
		})
		expect(adapter?.capture).toBeUndefined()
	})

	it('treats empty-string capture fields as unset', () => {
		const adapter = build({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'k', projectToken: '', region: '' },
		})
		expect(adapter?.capture).toBeUndefined()
	})

	it('returns null for unknown or missing provider values', () => {
		expect(build({ provider: 'nope' })).toBeNull()
		expect(build({})).toBeNull()
	})

	it('treats empty-string hosts as unset so cloud defaults apply', () => {
		const adapter = build({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k', host: '' },
		})
		expect(adapter?.isConfigured()).toBe(true)
	})
})

describe('instance ids', () => {
	it('assigns provider:docId as the adapter id', () => {
		const adapter = build({
			id: 'doc1',
			name: 'Tenant PH',
			provider: 'posthog',
			posthog: { projectId: '123', apiKey: 'phx_k' },
		})
		expect(adapter?.id).toBe('posthog:doc1')
	})

	it('uses the document name as the label', () => {
		const adapter = build({
			id: 'doc1',
			name: 'Tenant PH',
			provider: 'posthog',
			posthog: { projectId: '123', apiKey: 'phx_k' },
		})
		expect(adapter?.label).toBe('Tenant PH')
	})

	it('falls back to the provider label plus a short id when name is empty', () => {
		const adapter = build({
			id: '665f00aa11bb22cc33dd44ee',
			provider: 'posthog',
			posthog: { projectId: '123', apiKey: 'phx_k' },
		})
		expect(adapter?.label).toBe('PostHog dd44ee')
	})

	it('keeps the plain provider id when the document has no id', () => {
		const adapter = build({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k' },
		})
		expect(adapter?.id).toBe('plausible')
	})

	it('two documents of the same provider type get distinct working adapters', () => {
		const a = build({
			id: 'a',
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'k1' },
		})
		const b = build({
			id: 'b',
			provider: 'posthog',
			posthog: { projectId: '2', apiKey: 'k2' },
		})
		expect(a?.id).toBe('posthog:a')
		expect(b?.id).toBe('posthog:b')
		expect(a?.isConfigured()).toBe(true)
		expect(b?.isConfigured()).toBe(true)
	})

	it('numeric document ids work (postgres)', () => {
		const adapter = build({
			id: 42,
			provider: 'umami',
			umami: { websiteId: 'w', apiKey: 'k' },
		})
		expect(adapter?.id).toBe('umami:42')
	})
})

describe('normalizePrivateKey', () => {
	it('converts escaped newlines to real ones', () => {
		expect(normalizePrivateKey('a\\nb\\nc')).toBe('a\nb\nc')
	})
	it('leaves real newlines untouched', () => {
		expect(normalizePrivateKey('a\nb')).toBe('a\nb')
	})
})

describe('adapterFromProviderDoc under a host policy', () => {
	const hosts = resolveHostPolicy({
		allow: ['https://analytics.example.com', 'https://*.umami.example.net'],
	})

	const query: AnalyticsQuery = {
		metrics: ['pageviews'],
		dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-31T00:00:00Z') },
	}

	/** A fetch that records every URL it is asked for and answers what each vendor expects. */
	const recording = (): { fetch: FetchLike; urls: string[]; inits: FetchInit[] } => {
		const urls: string[] = []
		const inits: FetchInit[] = []
		const fetch: FetchLike = async (input, init) => {
			urls.push(String(input))
			inits.push(init ?? {})
			const body = String(input).includes('/stats')
				? { pageviews: 1, visitors: 1, visits: 1, bounces: 0, totaltime: 0 }
				: String(input).includes('/query')
					? { results: [{ metrics: [1], dimensions: [] }], columns: [], types: [] }
					: {}
			return Response.json(body)
		}
		return { fetch, urls, inits }
	}

	const plausibleDoc = (host: string | null): ProviderDoc => ({
		id: 'doc1',
		name: 'Tenant Plausible',
		provider: 'plausible',
		plausible: { siteId: 'site.test', apiKey: 'key', host, domain: 'site.test' },
	})

	it('builds a refused adapter for a host neither the cloud nor the list names', async () => {
		const { fetch, urls } = recording()
		const adapter = build(plausibleDoc('https://evil.example.org'), {
			hosts,
			fetch,
		})
		const allowed = build(plausibleDoc(null), { hosts, fetch })
		expect(adapter?.id).toBe('plausible:doc1')
		expect(adapter?.label).toBe('Tenant Plausible')
		expect(adapter?.capabilities).toEqual(allowed?.capabilities)
		expect(adapter?.isConfigured()).toBe(true)
		expect(adapter?.capture).toBeUndefined()
		const read = adapter?.query(query, {})
		await expect(read).rejects.toBeInstanceOf(SourceMisconfiguredError)
		await expect(read).rejects.toSatisfy(isSourceMisconfigured)
		await expect(read).rejects.toSatisfy(isHostRefused)
		await expect(read).rejects.toThrow(
			'analytics: https://evil.example.org is refused: it is not listed in providers.hosts.allow'
		)
		expect(urls).toEqual([])
	})

	it('keeps a refused host unconfigured while its credentials are missing', () => {
		const { fetch } = recording()
		const doc = plausibleDoc('https://evil.example.org')
		const adapter = build({ ...doc, plausible: { ...doc.plausible, apiKey: '' } }, { hosts, fetch })
		expect(adapter?.isConfigured()).toBe(false)
	})

	it('reads under the base path of an address whose origin is listed', async () => {
		const { fetch, urls } = recording()
		const adapter = build(plausibleDoc('https://analytics.example.com/plausible/'), {
			hosts,
			fetch,
		})
		await adapter?.query(query, {})
		expect(urls).toEqual(['https://analytics.example.com/plausible/api/v2/query'])
		expect(adapter?.capture?.proxy.routes.map((route) => route.upstream)).toEqual([
			'https://analytics.example.com/plausible/js/:script*',
			'https://analytics.example.com/plausible/api/event',
		])
	})

	it('matches the allowlist on the origin alone, whatever the path names', async () => {
		const { fetch, urls } = recording()
		for (const host of [
			'https://evil.example.org/analytics.example.com',
			'https://analytics.example.com/?next=x',
			'https://analytics.example.com/#x',
			'https://user:pass@analytics.example.com',
		]) {
			const adapter = build(plausibleDoc(host), { hosts, fetch })
			await expect(adapter?.query(query, {}), host).rejects.toBeInstanceOf(SourceMisconfiguredError)
		}
		expect(urls).toEqual([])
	})

	it('reads a listed host through the fetch it was given, capture included', async () => {
		const { fetch, urls } = recording()
		const adapter = build(plausibleDoc('https://analytics.example.com'), {
			hosts,
			fetch,
		})
		await adapter?.query(query, {})
		expect(urls).toEqual(['https://analytics.example.com/api/v2/query'])
		expect(adapter?.capture?.proxy.fetch).toBe(fetch)
		expect(adapter?.capture?.proxy.routes.map((route) => route.upstream)).toEqual([
			'https://analytics.example.com/js/:script*',
			'https://analytics.example.com/api/event',
		])
	})

	it('always allows each vendor cloud', async () => {
		for (const [doc, url] of [
			[plausibleDoc('https://plausible.io'), 'https://plausible.io/api/v2/query'],
			[plausibleDoc(''), 'https://plausible.io/api/v2/query'],
			[
				{
					provider: 'posthog',
					posthog: { projectId: '1', apiKey: 'k', host: 'https://eu.posthog.com' },
				},
				'https://eu.posthog.com/api/projects/1/query/',
			],
			[
				{
					provider: 'posthog',
					posthog: { projectId: '1', apiKey: 'k', host: 'https://app.posthog.com' },
				},
				'https://app.posthog.com/api/projects/1/query/',
			],
			[
				{ provider: 'umami', umami: { websiteId: 'w', apiKey: 'k', host: 'https://api.umami.is' } },
				'https://api.umami.is/v1/websites/w/stats',
			],
			[
				{
					provider: 'umami',
					umami: { websiteId: 'w', apiKey: 'k', host: 'https://cloud.umami.is' },
				},
				'https://api.umami.is/v1/websites/w/stats',
			],
		] satisfies Array<[ProviderDoc, string]>) {
			const { fetch, urls } = recording()
			await build(doc, { hosts, fetch })?.query(query, {})
			expect(urls[0]?.split('?')[0]).toBe(url)
		}
	})

	it("reads an Umami document's origin as the app, whose API lives under /api", async () => {
		const { fetch, urls } = recording()
		const adapter = build(
			{
				provider: 'umami',
				umami: { websiteId: 'w', token: 't', host: 'https://a.umami.example.net' },
			},
			{ hosts, fetch }
		)
		await adapter?.query(query, {})
		expect(urls[0]?.split('?')[0]).toBe('https://a.umami.example.net/api/websites/w/stats')
		expect(adapter?.capture?.proxy.routes.map((route) => route.upstream)).toEqual([
			'https://a.umami.example.net/script.js',
			'https://a.umami.example.net/api/send',
		])
	})

	it('keeps Umami Cloud on its own API and capture hosts', () => {
		const adapter = build(
			{ provider: 'umami', umami: { websiteId: 'w', apiKey: 'k', host: 'https://api.umami.is' } },
			{ hosts }
		)
		expect(adapter?.capture?.proxy.routes.map((route) => route.upstream)).toEqual([
			'https://cloud.umami.is/script.js',
			'https://gateway.umami.is/api/send',
		])
	})

	it('reads an Umami address that already ends in /api, or sits under a base path, once under /api', async () => {
		for (const [host, url] of [
			['https://a.umami.example.net/api/', 'https://a.umami.example.net/api/websites/w/stats'],
			[
				'https://a.umami.example.net/umami',
				'https://a.umami.example.net/umami/api/websites/w/stats',
			],
		]) {
			const { fetch, urls } = recording()
			await build(
				{ provider: 'umami', umami: { websiteId: 'w', token: 't', host } },
				{ hosts, fetch }
			)?.query(query, {})
			expect(urls[0]?.split('?')[0]).toBe(url)
		}
	})

	it('throws without a fetch and a host policy, rather than sending a stored key anywhere unchecked', () => {
		const doc = plausibleDoc('https://evil.example.org')
		for (const ctx of [
			undefined,
			{},
			{ hosts },
			{ fetch: guarded.fetch },
			{ fetch: guarded.fetch, hosts: {} },
		]) {
			expect(() => adapterFromProviderDoc(doc, ctx as unknown as ProviderFactoryContext)).toThrow(
				'analytics: adapterFromProviderDoc needs { fetch, hosts }'
			)
		}
	})

	it('leaves GA4, which names no host, to the policy-free path', () => {
		const adapter = build(
			{ provider: 'ga4', ga4: { propertyId: '1', clientEmail: 'svc@x.iam', privateKey: 'pk' } },
			{ hosts }
		)
		expect(adapter?.id).toBe('ga4')
		expect(adapter?.isConfigured()).toBe(true)
	})

	it("reads a GA4 document through the plugin's sdks.ga4", async () => {
		const runReport = vi.fn(async () => [{ rows: [], totals: [] }])
		const constructed = vi.fn()
		class BetaAnalyticsDataClient {
			constructor(options: unknown) {
				constructed(options)
			}
			runReport = runReport
		}
		const sdk = { BetaAnalyticsDataClient } as unknown as Ga4Sdk
		const adapter = build(
			{ provider: 'ga4', ga4: { propertyId: '1', clientEmail: 'svc@x.iam', privateKey: 'pk' } },
			{ sdks: { ga4: sdk } }
		)
		await adapter?.query(query, {})
		expect(constructed).toHaveBeenCalledWith({
			credentials: { client_email: 'svc@x.iam', private_key: 'pk' },
		})
		expect(runReport).toHaveBeenCalled()
	})
})
