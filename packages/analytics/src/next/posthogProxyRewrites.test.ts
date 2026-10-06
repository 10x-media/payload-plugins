import { describe, expect, it } from 'vitest'
import { posthogProxyRewrites } from './posthogProxyRewrites'

describe('posthogProxyRewrites', () => {
	it('defaults to /ph against EU Cloud with assets before the catch-all', () => {
		expect(posthogProxyRewrites()).toEqual([
			{
				source: '/ph/static/:p*',
				destination: 'https://eu-assets.i.posthog.com/static/:p*',
			},
			{
				source: '/ph/array/:p*',
				destination: 'https://eu-assets.i.posthog.com/array/:p*',
			},
			{ source: '/ph/:p*', destination: 'https://eu.i.posthog.com/:p*' },
		])
	})

	it('targets the US hosts for region us', () => {
		const rewrites = posthogProxyRewrites({ region: 'us' })
		expect(rewrites[0]?.destination).toBe('https://us-assets.i.posthog.com/static/:p*')
		expect(rewrites[2]?.destination).toBe('https://us.i.posthog.com/:p*')
	})

	it('normalizes the path: adds a leading slash, strips trailing slashes', () => {
		expect(posthogProxyRewrites({ path: 'ingest' })[2]?.source).toBe('/ingest/:p*')
		expect(posthogProxyRewrites({ path: '/ingest/' })[2]?.source).toBe('/ingest/:p*')
	})

	it('keeps the catch-all last so asset routes win first', () => {
		const sources = posthogProxyRewrites({ path: '/px' }).map((r) => r.source)
		expect(sources).toEqual(['/px/static/:p*', '/px/array/:p*', '/px/:p*'])
	})
})
