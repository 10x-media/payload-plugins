import type { ProviderId } from './factory'

/**
 * Every credential path in the provider collection. The decrypting provider
 * source derives from this list; `collection.test.ts` asserts it stays in
 * parity with the collection's own secret fields so the two can't drift.
 */
export const SECRET_PATHS: ReadonlyArray<{ provider: ProviderId; path: string }> = [
	{ provider: 'plausible', path: 'plausible.apiKey' },
	{ provider: 'umami', path: 'umami.apiKey' },
	{ provider: 'umami', path: 'umami.token' },
	{ provider: 'ga4', path: 'ga4.privateKey' },
	{ provider: 'posthog', path: 'posthog.apiKey' },
]
