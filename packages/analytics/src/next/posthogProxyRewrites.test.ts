import { describe, expect, it } from 'vitest'
import { posthogProxyRewrites } from './posthogProxyRewrites'

describe('posthogProxyRewrites', () => {
	it('defaults to /ph against EU Cloud with assets before the catch-all', () => {
		expect(posthogProxyRewrites()).toEqual([
			{
				source: '/ph/static/:path*',
				destination: 'https://eu-assets.i.posthog.com/static/:path*',
			},
			{
				source: '/ph/array/:path*',
				destination: 'https://eu-assets.i.posthog.com/array/:path*',
			},
			{ source: '/ph/:path*', destination: 'https://eu.i.posthog.com/:path*' },
		])
	})

	it('targets the US hosts for region us', () => {
		const rewrites = posthogProxyRewrites({ region: 'us' })
		expect(rewrites[0]?.destination).toBe('https://us-assets.i.posthog.com/static/:path*')
		expect(rewrites[2]?.destination).toBe('https://us.i.posthog.com/:path*')
	})

	it('normalizes the path: adds a leading slash, strips trailing slashes', () => {
		expect(posthogProxyRewrites({ path: 'ingest' })[2]?.source).toBe('/ingest/:path*')
		expect(posthogProxyRewrites({ path: '/ingest/' })[2]?.source).toBe('/ingest/:path*')
	})

	it('keeps the catch-all last so asset routes win first', () => {
		const sources = posthogProxyRewrites({ path: '/px' }).map((r) => r.source)
		expect(sources).toEqual(['/px/static/:path*', '/px/array/:path*', '/px/:path*'])
	})
})
