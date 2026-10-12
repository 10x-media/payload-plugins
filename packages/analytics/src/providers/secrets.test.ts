import { describe, expect, it } from 'vitest'
import { PROVIDER_IDS } from './factory'
import { CONNECTION_PATHS, SECRET_PATHS } from './secrets'

describe('SECRET_PATHS', () => {
	it('lists every credential field that must be encrypted', () => {
		expect(SECRET_PATHS).toEqual([
			{ provider: 'plausible', path: 'plausible.apiKey' },
			{ provider: 'umami', path: 'umami.apiKey' },
			{ provider: 'umami', path: 'umami.token' },
			{ provider: 'ga4', path: 'ga4.privateKey' },
			{ provider: 'posthog', path: 'posthog.apiKey' },
		])
	})
})

describe('CONNECTION_PATHS', () => {
	it('lists every value that decides where a document connects', () => {
		expect(CONNECTION_PATHS).toEqual([
			{ provider: null, path: 'provider' },
			{ provider: 'plausible', path: 'plausible.host' },
			{ provider: 'plausible', path: 'plausible.siteId' },
			{ provider: 'umami', path: 'umami.host' },
			{ provider: 'umami', path: 'umami.websiteId' },
			{ provider: 'ga4', path: 'ga4.propertyId' },
			{ provider: 'ga4', path: 'ga4.projectId' },
			{ provider: 'ga4', path: 'ga4.clientEmail' },
			{ provider: 'posthog', path: 'posthog.host' },
			{ provider: 'posthog', path: 'posthog.region' },
			{ provider: 'posthog', path: 'posthog.projectId' },
			{ provider: 'posthog', path: 'posthog.scopeProperty' },
		])
	})

	it('names a connection value for every provider that stores a secret', () => {
		const connected = new Set(CONNECTION_PATHS.map((entry) => entry.provider))
		for (const { provider } of SECRET_PATHS) {
			expect(connected.has(provider)).toBe(true)
		}
	})

	it('keeps every group path inside its own provider group', () => {
		for (const { provider, path } of CONNECTION_PATHS) {
			if (provider === null) {
				expect(path.includes('.')).toBe(false)
				continue
			}
			expect(PROVIDER_IDS).toContain(provider)
			expect(path.startsWith(`${provider}.`)).toBe(true)
		}
	})
})
