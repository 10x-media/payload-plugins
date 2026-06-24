import { describe, expect, it } from 'vitest'
import { noopResolver, platformHeaderResolver } from './geoResolver'

const headers = (h: Record<string, string>) => new Headers(h)

describe('platformHeaderResolver', () => {
	it('reads Vercel headers', async () => {
		const geo = await platformHeaderResolver(
			headers({ 'x-vercel-ip-country': 'US', 'x-vercel-ip-city': 'NYC' })
		)
		expect(geo).toEqual({ country: 'US', region: undefined, city: 'NYC' })
	})
	it('falls back to Cloudflare country', async () => {
		const geo = await platformHeaderResolver(headers({ 'cf-ipcountry': 'DE' }))
		expect(geo.country).toBe('DE')
	})
	it('returns empty geo when no headers present', async () => {
		expect(await platformHeaderResolver(headers({}))).toEqual({
			country: undefined,
			region: undefined,
			city: undefined,
		})
	})
})

describe('noopResolver', () => {
	it('always returns empty geo', async () => {
		expect(await noopResolver(headers({ 'x-vercel-ip-country': 'US' }))).toEqual({})
	})
})
