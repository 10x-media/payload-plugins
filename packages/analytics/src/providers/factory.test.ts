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

describe('normalizePrivateKey', () => {
	it('converts escaped newlines to real ones', () => {
		expect(normalizePrivateKey('a\\nb\\nc')).toBe('a\nb\nc')
	})
	it('leaves real newlines untouched', () => {
		expect(normalizePrivateKey('a\nb')).toBe('a\nb')
	})
})
