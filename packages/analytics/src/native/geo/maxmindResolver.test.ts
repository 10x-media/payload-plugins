import { describe, expect, it } from 'vitest'
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
