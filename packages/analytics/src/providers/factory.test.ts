import { describe, expect, it } from 'vitest'
import { adapterFromProviderDoc, normalizePrivateKey } from './factory'

describe('adapterFromProviderDoc', () => {
	it('builds a configured plausible adapter from a complete doc', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'plausible',
			plausible: { siteId: 'example.com', apiKey: 'key' },
		})
		expect(adapter?.id).toBe('plausible')
		expect(adapter?.isConfigured()).toBe(true)
	})

	it('builds an unconfigured adapter when credentials are missing', () => {
		const adapter = adapterFromProviderDoc({ provider: 'plausible', plausible: { host: 'x' } })
		expect(adapter?.id).toBe('plausible')
		expect(adapter?.isConfigured()).toBe(false)
	})

	it('builds umami from either apiKey or token', () => {
		const cloud = adapterFromProviderDoc({
			provider: 'umami',
			umami: { websiteId: 'w', apiKey: 'k' },
		})
		expect(cloud?.isConfigured()).toBe(true)
		const selfHosted = adapterFromProviderDoc({
			provider: 'umami',
			umami: { websiteId: 'w', token: 't', host: 'https://self/api' },
		})
		expect(selfHosted?.isConfigured()).toBe(true)
	})

	it('builds ga4 with normalized credentials', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'ga4',
			ga4: { propertyId: '123', clientEmail: 'svc@x.iam', privateKey: 'line1\\nline2' },
		})
		expect(adapter?.id).toBe('ga4')
		expect(adapter?.isConfigured()).toBe(true)
	})

	it('builds posthog from projectId and apiKey', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'phx_x' },
		})
		expect(adapter?.id).toBe('posthog')
		expect(adapter?.isConfigured()).toBe(true)
	})

	// Capture is declared only from public config, so these fields are what let a provider
	// document fill a tenant capture slot at all.
	it('passes the public posthog capture fields through to the adapter', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'phx_x', projectToken: 'phc_public', region: 'eu' },
		})
		expect(adapter?.capture?.client).toEqual({ kind: 'posthog', token: 'phc_public' })
		expect(adapter?.capture?.proxy.routes[0]?.upstream).toBe(
			'https://eu-assets.i.posthog.com/static/:p*'
		)
	})

	it('declares no posthog capture when the document carries no projectToken', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'phx_x' },
		})
		expect(adapter?.capture).toBeUndefined()
	})

	it('passes the public plausible capture fields through to the adapter', () => {
		const domain = adapterFromProviderDoc({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k', domain: 'site.test' },
		})
		expect(domain?.capture?.snippet({ path: '/pl' }).scripts[0]?.attrs).toEqual({
			'data-domain': 'site.test',
			'data-api': '/pl/api/event',
		})
		const scripted = adapterFromProviderDoc({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k', scriptId: 'abc123' },
		})
		expect(scripted?.capture?.snippet({ path: '/pl' }).scripts[0]?.src).toBe('/pl/js/pa-abc123.js')
	})

	it('declares no plausible capture without a domain or scriptId', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k' },
		})
		expect(adapter?.capture).toBeUndefined()
	})

	it('treats empty-string capture fields as unset', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'k', projectToken: '', region: '' },
		})
		expect(adapter?.capture).toBeUndefined()
	})

	it('returns null for unknown or missing provider values', () => {
		expect(adapterFromProviderDoc({ provider: 'nope' })).toBeNull()
		expect(adapterFromProviderDoc({})).toBeNull()
	})

	it('treats empty-string hosts as unset so cloud defaults apply', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k', host: '' },
		})
		expect(adapter?.isConfigured()).toBe(true)
	})
})

describe('instance ids', () => {
	it('assigns provider:docId as the adapter id', () => {
		const adapter = adapterFromProviderDoc({
			id: 'doc1',
			name: 'Tenant PH',
			provider: 'posthog',
			posthog: { projectId: '123', apiKey: 'phx_k' },
		})
		expect(adapter?.id).toBe('posthog:doc1')
	})

	it('uses the document name as the label', () => {
		const adapter = adapterFromProviderDoc({
			id: 'doc1',
			name: 'Tenant PH',
			provider: 'posthog',
			posthog: { projectId: '123', apiKey: 'phx_k' },
		})
		expect(adapter?.label).toBe('Tenant PH')
	})

	it('falls back to the provider label plus a short id when name is empty', () => {
		const adapter = adapterFromProviderDoc({
			id: '665f00aa11bb22cc33dd44ee',
			provider: 'posthog',
			posthog: { projectId: '123', apiKey: 'phx_k' },
		})
		expect(adapter?.label).toBe('PostHog dd44ee')
	})

	it('keeps the plain provider id when the document has no id', () => {
		const adapter = adapterFromProviderDoc({
			provider: 'plausible',
			plausible: { siteId: 's', apiKey: 'k' },
		})
		expect(adapter?.id).toBe('plausible')
	})

	it('two documents of the same provider type get distinct working adapters', () => {
		const a = adapterFromProviderDoc({
			id: 'a',
			provider: 'posthog',
			posthog: { projectId: '1', apiKey: 'k1' },
		})
		const b = adapterFromProviderDoc({
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
		const adapter = adapterFromProviderDoc({
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
