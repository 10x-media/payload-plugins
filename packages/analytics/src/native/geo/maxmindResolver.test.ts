import { describe, expect, it, vi } from 'vitest'
import type { MaxmindSdk } from '../../core/sdks'
import { composeGeoResolvers } from './composeGeoResolvers'
import { needsMaxmindSdk, platformHeaderResolver } from './geoResolver'
import { maxmindResolver } from './maxmindResolver'

const headers = (h: Record<string, string>) => new Headers(h)

describe('maxmindResolver', () => {
	it('degrades to empty geo when the database file is missing (no throw)', async () => {
		const resolve = maxmindResolver({ dbPath: '/nonexistent/GeoLite2-City.mmdb' })
		const geo = await resolve(headers({ 'x-forwarded-for': '8.8.8.8' }))
		expect(geo).toEqual({})
	})
	it('degrades to empty geo when no client ip is present', async () => {
		const resolve = maxmindResolver({ dbPath: '/nonexistent/GeoLite2-City.mmdb' })
		expect(await resolve(headers({}))).toEqual({})
	})
})

describe('maxmindResolver sdk', () => {
	/** A reader of the shape `maxmind` opens, which knows one address. */
	const sdkWith = () => {
		const open = vi.fn(async () => ({
			get: (ip: string) =>
				ip === '8.8.8.8'
					? {
							country: { iso_code: 'US' },
							subdivisions: [{ iso_code: 'CA' }],
							city: { names: { en: 'Mountain View' } },
						}
					: null,
		}))
		return { sdk: { open } as unknown as MaxmindSdk, open }
	}

	const visit = new Headers({ 'x-forwarded-for': '8.8.8.8' })

	it('opens the database with the reader it was handed', async () => {
		const own = sdkWith()
		const resolve = maxmindResolver({ dbPath: '/data/City.mmdb', sdk: own.sdk })
		expect(await resolve(visit)).toEqual({ country: 'US', region: 'CA', city: 'Mountain View' })
		expect(own.open).toHaveBeenCalledWith('/data/City.mmdb')
		expect(needsMaxmindSdk(resolve)).toBe(false)
	})

	it("opens it with the plugin's sdks.maxmind when it has none, and is marked as needing one", async () => {
		const plugin = sdkWith()
		const resolve = maxmindResolver({ dbPath: '/data/City.mmdb' })
		expect(needsMaxmindSdk(resolve)).toBe(true)
		expect(await resolve(visit, { maxmind: plugin.sdk })).toMatchObject({ country: 'US' })
		expect(plugin.open).toHaveBeenCalledTimes(1)
	})

	it('passes the mark on through a composition that holds it, and only then', () => {
		const runtime = maxmindResolver({ dbPath: '/data/City.mmdb' })
		const handed = maxmindResolver({ dbPath: '/data/City.mmdb', sdk: sdkWith().sdk })
		expect(needsMaxmindSdk(composeGeoResolvers(platformHeaderResolver, runtime))).toBe(true)
		expect(needsMaxmindSdk(composeGeoResolvers(platformHeaderResolver, handed))).toBe(false)
		expect(needsMaxmindSdk(platformHeaderResolver)).toBe(false)
	})
})
