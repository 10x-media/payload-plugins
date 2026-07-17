import { describe, expect, it } from 'vitest'
import { analyticsProxyRewrites } from './analyticsProxyRewrites'
import { posthogProxyRewrites } from './posthogProxyRewrites'

describe('analyticsProxyRewrites', () => {
	it('matches posthogProxyRewrites for the posthog provider', () => {
		expect(analyticsProxyRewrites({ provider: 'posthog', region: 'us', path: '/px' })).toEqual(
			posthogProxyRewrites({ region: 'us', path: '/px' })
		)
	})

	it('proxies the Plausible script and event endpoint, defaulting host and path', () => {
		expect(analyticsProxyRewrites({ provider: 'plausible' })).toEqual([
			{ source: '/pa/js/:script*', destination: 'https://plausible.io/js/:script*' },
			{ source: '/pa/api/event', destination: 'https://plausible.io/api/event' },
		])
	})

	it('targets a self-hosted Plausible instance and custom path', () => {
		const rewrites = analyticsProxyRewrites({
			provider: 'plausible',
			path: '/stats',
			host: 'https://analytics.example.com/',
		})
		expect(rewrites).toEqual([
			{ source: '/stats/js/:script*', destination: 'https://analytics.example.com/js/:script*' },
			{ source: '/stats/api/event', destination: 'https://analytics.example.com/api/event' },
		])
	})

	it('proxies the Umami script from cloud and ingest to the gateway host', () => {
		expect(analyticsProxyRewrites({ provider: 'umami' })).toEqual([
			{ source: '/um/script.js', destination: 'https://cloud.umami.is/script.js' },
			{ source: '/um/api/send', destination: 'https://gateway.umami.is/api/send' },
		])
	})

	it('points both Umami routes at a self-hosted host when provided', () => {
		expect(
			analyticsProxyRewrites({ provider: 'umami', host: 'https://umami.example.com' })
		).toEqual([
			{ source: '/um/script.js', destination: 'https://umami.example.com/script.js' },
			{ source: '/um/api/send', destination: 'https://umami.example.com/api/send' },
		])
	})

	it('normalizes the proxy path', () => {
		expect(analyticsProxyRewrites({ provider: 'umami', path: 'track/' })[0]?.source).toBe(
			'/track/script.js'
		)
	})
})
