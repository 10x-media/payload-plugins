import { describe, expect, it } from 'vitest'
import type { TrustedPlatform } from '../../net/platform'
import { type Geo, noopResolver, platformHeaderResolver } from './geoResolver'

/** Every location header either platform writes, each carrying a value a visitor could forge. */
const EVERY_PLATFORM_HEADER = {
	'x-vercel-ip-country': 'US',
	'x-vercel-ip-country-region': 'CA',
	'x-vercel-ip-city': 'San Francisco',
	'cf-ipcountry': 'DE',
	'cf-region-code': 'BE',
	'cf-region': 'Berlin State',
	'cf-ipcity': 'Berlin',
}

const TRUST: Array<[trust: TrustedPlatform | undefined, expected: Geo]> = [
	['vercel', { country: 'US', region: 'CA', city: 'San Francisco' }],
	['cloudflare', { country: 'DE', region: 'BE', city: 'Berlin' }],
	[undefined, {}],
]

describe('platformHeaderResolver', () => {
	for (const [trustedPlatform, expected] of TRUST) {
		it(`reads ${trustedPlatform ?? 'no platform'}'s headers and only those`, async () => {
			const geo = await platformHeaderResolver(new Headers(EVERY_PLATFORM_HEADER), {
				...(trustedPlatform ? { trustedPlatform } : {}),
			})
			expect(geo).toStrictEqual(expected)
		})
	}

	it('ignores a spoofed cf-ipcountry when no platform is trusted, with or without proxy hops', async () => {
		const spoofed = new Headers({ 'cf-ipcountry': 'KP' })
		expect((await platformHeaderResolver(spoofed)).country).toBeUndefined()
		expect((await platformHeaderResolver(spoofed, { trustedProxyHops: 1 })).country).toBeUndefined()
	})

	it("ignores the other platform's headers", async () => {
		const vercelOnCloudflare = new Headers({ 'x-vercel-ip-country': 'US' })
		expect(
			(await platformHeaderResolver(vercelOnCloudflare, { trustedPlatform: 'cloudflare' })).country
		).toBeUndefined()
	})

	it('reads a missing optional header as absent', async () => {
		expect(
			await platformHeaderResolver(new Headers({ 'cf-ipcountry': 'FR' }), {
				trustedPlatform: 'cloudflare',
			})
		).toEqual({ country: 'FR', region: undefined, city: undefined })
	})
})

describe('noopResolver', () => {
	it('always returns empty geo', async () => {
		expect(
			await noopResolver(new Headers({ 'x-vercel-ip-country': 'US' }), {
				trustedPlatform: 'vercel',
			})
		).toEqual({})
	})
})
