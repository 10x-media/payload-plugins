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
