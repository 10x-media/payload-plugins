import type { ProviderId } from './factory'

/**
 * Every credential path in the providers collection; `collection.test.ts` holds it to the
 * collection's secret fields.
 *
 * @beta
 */
export const SECRET_PATHS: ReadonlyArray<{ provider: ProviderId; path: string }> = [
	{ provider: 'plausible', path: 'plausible.apiKey' },
	{ provider: 'umami', path: 'umami.apiKey' },
	{ provider: 'umami', path: 'umami.token' },
	{ provider: 'ga4', path: 'ga4.privateKey' },
	{ provider: 'posthog', path: 'posthog.apiKey' },
]

/**
 * Values that decide where a document's credentials go: changing one clears its stored secrets
 * unless they are sent again. `provider: null` marks the one every provider shares.
 *
 * @beta
 */
export const CONNECTION_PATHS: ReadonlyArray<{ provider: ProviderId | null; path: string }> = [
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
]
