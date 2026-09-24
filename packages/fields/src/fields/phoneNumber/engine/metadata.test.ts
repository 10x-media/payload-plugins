import { describe, expect, it } from 'vitest'
import { DEFAULT_METADATA_SET, loadMetadata, type MetadataSet } from './metadata'

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

	// Unvalidated config can reach here with an out-of-union set. A synchronous throw would
	// escape every caller's `.catch`, taking the render down instead of degrading the field.
	it('rejects rather than throwing for a set it does not carry', async () => {
		const set = 'nope' as unknown as MetadataSet
		let call: Promise<unknown> | undefined
		expect(() => {
			call = loadMetadata(set)
		}).not.toThrow()
		await expect(call).rejects.toThrow('nope')
	})

	it('does not cache the rejection, so a later call can retry', async () => {
		const set = 'also-nope' as unknown as MetadataSet
		await expect(loadMetadata(set)).rejects.toThrow()
		await expect(loadMetadata(set)).rejects.toThrow()
	})
})
