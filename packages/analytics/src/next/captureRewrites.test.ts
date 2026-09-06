import { compile, pathToRegexp } from 'path-to-regexp'
import { describe, expect, it } from 'vitest'
import { ga4 } from '../adapters/ga4/ga4'
import { plausible } from '../adapters/plausible/plausible'
import { posthog } from '../adapters/posthog/posthog'
import { umami } from '../adapters/umami/umami'
import { captureRewrites } from './captureRewrites'
import { posthogProxyRewrites } from './posthogProxyRewrites'

describe('captureRewrites', () => {
	it('maps PostHog routes in order, assets before the catch-all, for a custom path and region', () => {
		const adapter = posthog({ projectId: '', apiKey: '', region: 'eu' })
		expect(captureRewrites([{ path: '/px', adapter }])).toEqual([
			{ source: '/px/static/:p*', destination: 'https://eu-assets.i.posthog.com/static/:p*' },
			{ source: '/px/array/:p*', destination: 'https://eu-assets.i.posthog.com/array/:p*' },
			{ source: '/px/:p*', destination: 'https://eu.i.posthog.com/:p*' },
		])
	})

	it('targets the US hosts for region us', () => {
		const adapter = posthog({ projectId: '', apiKey: '', region: 'us' })
		const rewrites = captureRewrites([{ path: '/ph', adapter }])
		expect(rewrites[0]?.destination).toBe('https://us-assets.i.posthog.com/static/:p*')
		expect(rewrites[2]?.destination).toBe('https://us.i.posthog.com/:p*')
	})

	it('maps both Plausible routes', () => {
		const adapter = plausible({ siteId: '', apiKey: '', host: 'https://plausible.example.com' })
		expect(captureRewrites([{ path: '/pa', adapter }])).toEqual([
			{ source: '/pa/js/:script*', destination: 'https://plausible.example.com/js/:script*' },
			{ source: '/pa/api/event', destination: 'https://plausible.example.com/api/event' },
		])
	})

	it('maps Umami routes for cloud', () => {
		const adapter = umami({ websiteId: '' })
		expect(captureRewrites([{ path: '/um', adapter }])).toEqual([
			{ source: '/um/script.js', destination: 'https://cloud.umami.is/script.js' },
			{ source: '/um/api/send', destination: 'https://gateway.umami.is/api/send' },
		])
	})

	it('maps Umami routes for self-host', () => {
		const adapter = umami({ websiteId: '', host: 'https://analytics.example.com/api' })
		expect(captureRewrites([{ path: '/um', adapter }])).toEqual([
			{ source: '/um/script.js', destination: 'https://analytics.example.com/script.js' },
			{ source: '/um/api/send', destination: 'https://analytics.example.com/api/send' },
		])
	})

	it('contributes nothing for an adapter without capture (GA4)', () => {
		const adapter = ga4({ propertyId: '', credentials: { client_email: '', private_key: '' } })
		expect(captureRewrites([{ path: '/ga', adapter }])).toEqual([])
	})

	it('concatenates two slots in the order given', () => {
		const posthogAdapter = posthog({ projectId: '', apiKey: '', region: 'eu' })
		const umamiAdapter = umami({ websiteId: '' })
		const rewrites = captureRewrites([
			{ path: '/ph', adapter: posthogAdapter },
			{ path: '/um', adapter: umamiAdapter },
		])
		expect(rewrites.map((r) => r.source)).toEqual([
			'/ph/static/:p*',
			'/ph/array/:p*',
			'/ph/:p*',
			'/um/script.js',
			'/um/api/send',
		])
	})

	it('normalizes the mount path: adds a leading slash, strips trailing slashes', () => {
		const adapter = umami({ websiteId: '' })
		expect(captureRewrites([{ path: 'um', adapter }])[0]?.source).toBe('/um/script.js')
		expect(captureRewrites([{ path: '/um/', adapter }])[0]?.source).toBe('/um/script.js')
	})

	it('matches posthogProxyRewrites output exactly when fed the same descriptor', () => {
		for (const region of ['eu', 'us'] as const) {
			const adapter = posthog({ projectId: '', apiKey: '', region })
			expect(captureRewrites([{ path: '/ph', adapter }])).toEqual(
				posthogProxyRewrites({ path: '/ph', region })
			)
		}
	})

	it('produces source/destination pairs that compile with path-to-regexp', () => {
		const rewrites = [
			...captureRewrites([{ path: '/ph', adapter: posthog({ projectId: '', apiKey: '' }) }]),
			...captureRewrites([{ path: '/pa', adapter: plausible({ siteId: '', apiKey: '' }) }]),
			...captureRewrites([{ path: '/um', adapter: umami({ websiteId: '' }) }]),
		]
		expect(rewrites.length).toBeGreaterThan(0)
		const paramNames = (value: string): string[] =>
			[...value.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] as string)
		for (const { source, destination } of rewrites) {
			expect(() => pathToRegexp(source)).not.toThrow()
			const destinationPath = new URL(destination).pathname
			expect(() => compile(destinationPath)).not.toThrow()
			// Next refuses to build if a destination param isn't declared in the source.
			const sourceParams = paramNames(source)
			for (const name of paramNames(destination)) {
				expect(sourceParams).toContain(name)
			}
		}
	})

	it('throws for a mount path that normalizes to the site root', () => {
		const adapter = posthog({ projectId: '', apiKey: '' })
		expect(() => captureRewrites([{ path: '/', adapter }])).toThrow(
			'captureRewrites: mount path must not be the site root'
		)
		expect(() => captureRewrites([{ path: '', adapter }])).toThrow(
			'captureRewrites: mount path must not be the site root'
		)
	})

	it('throws when two mounts normalize to the same path', () => {
		const posthogAdapter = posthog({ projectId: '', apiKey: '' })
		const umamiAdapter = umami({ websiteId: '' })
		expect(() =>
			captureRewrites([
				{ path: '/ph', adapter: posthogAdapter },
				{ path: '/ph/', adapter: umamiAdapter },
			])
		).toThrow("captureRewrites: mount paths collide: '/ph' and '/ph'")
	})

	it('throws when one mount path is nested under another', () => {
		const posthogAdapter = posthog({ projectId: '', apiKey: '' })
		const umamiAdapter = umami({ websiteId: '' })
		expect(() =>
			captureRewrites([
				{ path: '/ph', adapter: posthogAdapter },
				{ path: '/ph/x', adapter: umamiAdapter },
			])
		).toThrow("captureRewrites: mount paths collide: '/ph' and '/ph/x'")
	})

	it('allows distinct sibling paths that merely share a prefix string', () => {
		const posthogAdapter = posthog({ projectId: '', apiKey: '' })
		const umamiAdapter = umami({ websiteId: '' })
		expect(() =>
			captureRewrites([
				{ path: '/ph', adapter: posthogAdapter },
				{ path: '/phx', adapter: umamiAdapter },
			])
		).not.toThrow()
		expect(() =>
			captureRewrites([
				{ path: '/ph', adapter: posthogAdapter },
				{ path: '/pl', adapter: umamiAdapter },
			])
		).not.toThrow()
	})
})
