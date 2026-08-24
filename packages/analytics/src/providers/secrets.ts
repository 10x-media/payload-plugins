import type { ProviderId } from './factory'

/**
 * Every credential path in the provider collection, the single list the
 * collection's field builder and the decrypting provider source both derive
 * from so they can never disagree.
 */
export const SECRET_PATHS: ReadonlyArray<{ provider: ProviderId; path: string }> = [
	{ provider: 'plausible', path: 'plausible.apiKey' },
	{ provider: 'umami', path: 'umami.apiKey' },
	{ provider: 'umami', path: 'umami.token' },
	{ provider: 'ga4', path: 'ga4.privateKey' },
	{ provider: 'posthog', path: 'posthog.apiKey' },
]

export const secretPathsFor = (provider: string): string[] =>
	SECRET_PATHS.filter((s) => s.provider === provider).map((s) => s.path)
