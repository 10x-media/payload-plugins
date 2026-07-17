import { describe, expect, it, vi } from 'vitest'
import type { IconAdapter } from '../../../types'
import { loadManifestNames } from './manifestCache'

const makeAdapter = (slug: string, loadManifest: IconAdapter['loadManifest']): IconAdapter => ({
	slug,
	label: slug,
	loadManifest,
	Icon: `x#${slug}Icon`,
	Assets: `x#${slug}Assets`,
	version: 1,
})

describe('loadManifestNames', () => {
	it('caches the name set per slug@version', async () => {
		const loadManifest = vi.fn(() =>
			Promise.resolve({ categories: [], icons: [{ categories: [], name: 'house', tags: [] }] })
		)
		const adapter = makeAdapter('cache-hit', loadManifest)
		const first = await loadManifestNames(adapter)
		const second = await loadManifestNames(adapter)
		expect(first).toBe(second)
		expect(first.has('house')).toBe(true)
		expect(loadManifest).toHaveBeenCalledTimes(1)
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
		await expect(loadManifestNames(adapter)).rejects.toThrow('transient')
		const names = await loadManifestNames(adapter)
		expect(names.has('heart')).toBe(true)
		expect(loadManifest).toHaveBeenCalledTimes(2)
	})
})
