import { describe, expect, it } from 'vitest'
import type { IconManifest } from '../../../types'

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/

const assertManifestShape = (manifest: IconManifest, minIcons: number) => {
	expect(manifest.icons.length).toBeGreaterThan(minIcons)
	const names = new Set<string>()
	const categorySet = new Set(manifest.categories)
	for (const icon of manifest.icons) {
		expect(icon.name).toMatch(KEBAB)
		expect(names.has(icon.name)).toBe(false)
		names.add(icon.name)
		expect(Array.isArray(icon.tags)).toBe(true)
		for (const category of icon.categories) expect(categorySet.has(category)).toBe(true)
	}
	expect(manifest.categories).toEqual([...manifest.categories].sort())
}

describe('committed adapter manifests', () => {
	it('lucide manifest is well formed', async () => {
		const { manifest } = await import('./lucide/generated/manifest')
		assertManifestShape(manifest, 1500)
		expect(manifest.icons.some((icon) => icon.name === 'house')).toBe(true)
	})

	it('radix manifest is well formed and has an imports map', async () => {
		const { manifest } = await import('./radix/generated/manifest')
		assertManifestShape(manifest, 300)
		const { iconImports } = await import('./radix/generated/imports')
		expect(Object.keys(iconImports).length).toBe(manifest.icons.length)
	})

	it('tabler manifest is well formed and has an imports map', async () => {
		const { manifest } = await import('./tabler/generated/manifest')
		assertManifestShape(manifest, 4000)
		const { iconImports } = await import('./tabler/generated/imports')
		expect(Object.keys(iconImports).length).toBe(manifest.icons.length)
		expect(iconImports.heart).toBeDefined()
	})
})
