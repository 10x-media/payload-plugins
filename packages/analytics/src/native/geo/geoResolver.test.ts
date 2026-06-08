import { describe, expect, it } from 'vitest'
import { noopResolver, platformHeaderResolver } from './geoResolver'

const headers = (h: Record<string, string>) => new Headers(h)

describe('platformHeaderResolver', () => {
	it('reads Vercel headers', () => {
		const geo = platformHeaderResolver(
			headers({ 'x-vercel-ip-country': 'US', 'x-vercel-ip-city': 'NYC' })
		)
		expect(geo).toEqual({ country: 'US', region: undefined, city: 'NYC' })
	})
	it('falls back to Cloudflare country', () => {
		expect(platformHeaderResolver(headers({ 'cf-ipcountry': 'DE' })).country).toBe('DE')
	})
	it('returns empty geo when no headers present', () => {
		expect(platformHeaderResolver(headers({}))).toEqual({
			country: undefined,
			region: undefined,
			city: undefined,
		})
	})
})

describe('noopResolver', () => {
	it('always returns empty geo', () => {
		expect(noopResolver(headers({ 'x-vercel-ip-country': 'US' }))).toEqual({})
	})
})
