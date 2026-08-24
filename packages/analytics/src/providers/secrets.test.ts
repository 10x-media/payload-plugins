import { describe, expect, it } from 'vitest'
import { SECRET_PATHS, secretPathsFor } from './secrets'

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

	it('resolves the paths for one provider', () => {
		expect(secretPathsFor('umami')).toEqual(['umami.apiKey', 'umami.token'])
		expect(secretPathsFor('nope')).toEqual([])
	})
})
