import { describe, expect, it } from 'vitest'
import { composeGeoResolvers } from './composeGeoResolvers'

describe('composeGeoResolvers', () => {
	it('returns the first resolver result that has a country', async () => {
		const r = composeGeoResolvers(
			() => ({}),
			() => ({ country: 'DE' }),
			() => ({ country: 'US' })
		)
		expect(await r(new Headers())).toEqual({ country: 'DE' })
	})
	it('returns empty geo when none resolve a country', async () => {
		const r = composeGeoResolvers(
			() => ({}),
			async () => ({})
		)
		expect(await r(new Headers())).toEqual({})
	})
})
