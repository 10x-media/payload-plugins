import { describe, expect, it, vi } from 'vitest'
import type { IconAdapter } from '../../../types'
import { loadManifestIndex } from './manifestCache'

const makeAdapter = (slug: string, loadManifest: IconAdapter['loadManifest']): IconAdapter => ({
	slug,
	label: slug,
	loadManifest,
	Icon: `x#${slug}Icon`,
	Assets: `x#${slug}Assets`,
	version: 1,
})

describe('loadManifestIndex', () => {
	it('caches the index per slug@version', async () => {
		const loadManifest = vi.fn(() =>
			Promise.resolve({ categories: [], icons: [{ categories: [], name: 'house', tags: [] }] })
		)
		const adapter = makeAdapter('cache-hit', loadManifest)
		const first = await loadManifestIndex(adapter)
		const second = await loadManifestIndex(adapter)
		expect(first).toBe(second)
		expect(first.has('house')).toBe(true)
		expect(loadManifest).toHaveBeenCalledTimes(1)
	})

	// Existence and label resolution are the same lookup, so the index keeps whole
	// entries rather than bare names. Validation reads `has`, labels read `get`.
	it('keys whole manifest entries by name', async () => {
		const loadManifest = vi.fn(() =>
			Promise.resolve({
				categories: ['flags'],
				icons: [{ categories: ['flags'], label: 'Hungary', name: 'HUN', tags: ['hungary'] }],
			})
		)
		const index = await loadManifestIndex(makeAdapter('with-labels', loadManifest))
		expect(index.get('HUN')).toEqual({
			categories: ['flags'],
			label: 'Hungary',
			name: 'HUN',
			tags: ['hungary'],
		})
	})

	it('evicts a rejected load so the next call retries', async () => {
		let attempt = 0
		const loadManifest = vi.fn(() => {
			attempt += 1
			return attempt === 1
				? Promise.reject(new Error('transient'))
				: Promise.resolve({ categories: [], icons: [{ categories: [], name: 'heart', tags: [] }] })
		})
		const adapter = makeAdapter('evict-me', loadManifest)
		await expect(loadManifestIndex(adapter)).rejects.toThrow('transient')
		const index = await loadManifestIndex(adapter)
		expect(index.has('heart')).toBe(true)
		expect(loadManifest).toHaveBeenCalledTimes(2)
	})
})
