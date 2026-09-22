import { describe, expect, it } from 'vitest'
import { DEFAULT_METADATA_SET, loadMetadata } from './metadata'

describe('loadMetadata', () => {
	it('defaults to the max set, the only one carrying number types', () => {
		expect(DEFAULT_METADATA_SET).toBe('max')
	})

	it('loads a set that libphonenumber can consume', async () => {
		const metadata = await loadMetadata('max')
		expect(metadata).toHaveProperty('countries')
		expect(Object.keys((metadata as { countries: object }).countries).length).toBeGreaterThan(200)
	})

	it('returns the identical object on repeat calls, so metadata is parsed once', async () => {
		const [a, b] = await Promise.all([loadMetadata('min'), loadMetadata('min')])
		expect(a).toBe(b)
	})

	it('keeps sets separate', async () => {
		expect(await loadMetadata('max')).not.toBe(await loadMetadata('min'))
	})
})
