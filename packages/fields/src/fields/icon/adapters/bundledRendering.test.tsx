import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { IconCanvas, IconManifest, IconNodeMap } from '../../../types'
import { DrawerGlyph } from '../client/DrawerGlyph'
import type { IconRendererAdapter } from '../react/types'
import { resolveIconDisplay } from '../shared/iconLabel'
import { lucideRenderer } from './lucide/renderer'
import { radixAdapter } from './radix/adapter'
import { radixRenderer } from './radix/renderer'
import { tablerRenderer } from './tabler/renderer'

/**
 * Characterization tests pinning how the three bundled libraries render, so the layer
 * and render-strategy work cannot move them. These assert current behaviour rather than
 * desired behaviour on purpose: the hashes were taken from a tree in which
 * `client/DrawerGlyph.tsx` and all of `adapters/` are byte-identical to main, so they
 * pin the shipped output, not this branch's.
 *
 * A hash covers every glyph in a library, which no hand-written sample could. The exact
 * examples beside it exist so a failure says what broke instead of only that something did.
 */

const hashGlyphs = (nodeMap: IconNodeMap, canvas?: IconCanvas): string => {
	const hash = createHash('sha256')
	for (const name of Object.keys(nodeMap).sort()) {
		const glyph = nodeMap[name]
		if (!glyph) continue
		hash.update(name)
		hash.update(renderToStaticMarkup(<DrawerGlyph canvas={canvas} nodes={glyph} size={24} />))
	}
	return hash.digest('hex')
}

/** Evenly spread sample across a sorted name list, so it covers varied glyph shapes deterministically. */
const sampleNames = (names: string[], count: number): string[] => {
	const sorted = [...names].sort()
	const step = Math.max(1, Math.floor(sorted.length / count))
	const picked: string[] = []
	for (let index = 0; index < sorted.length && picked.length < count; index += step) {
		const name = sorted[index]
		if (name !== undefined) picked.push(name)
	}
	return picked
}

const hashRendered = async (
	adapter: IconRendererAdapter,
	names: string[]
): Promise<{ hash: string; resolved: number }> => {
	const hash = createHash('sha256')
	let resolved = 0
	for (const name of names) {
		const Component = await adapter.loadIcon(name)
		if (!Component) continue
		resolved += 1
		hash.update(name)
		hash.update(renderToStaticMarkup(<Component size={20} />))
	}
	return { hash: hash.digest('hex'), resolved }
}

describe('bundled library rendering is unchanged', () => {
	it('renders every lucide glyph identically', async () => {
		const { nodes } = await import('./lucide/generated/nodes')
		expect(Object.keys(nodes).length).toBeGreaterThan(1000)
		expect(hashGlyphs(nodes)).toBe(
			'62e11abdef5471582284f3ff654269d1987c1485715f10daa2bc0351a11d3334'
		)
	})

	it('renders every tabler glyph identically', async () => {
		const { nodes } = await import('./tabler/generated/nodes')
		expect(Object.keys(nodes).length).toBeGreaterThan(4000)
		expect(hashGlyphs(nodes)).toBe(
			'98de3badb7d09f26bb4bf141c27d8a668839edc50bd2963f89a03fcf20dcf9b1'
		)
	})

	// Radix joined the bulk fast path once a layer could declare its canvas. It is a
	// filled 15x15 set, so it would render stroked under the outline default; this pins
	// both the node-data and the canvas that makes it correct.
	it('renders every radix glyph on its declared canvas', async () => {
		const { nodes } = await import('./radix/generated/nodes')
		expect(Object.keys(nodes).length).toBe(318)
		expect(hashGlyphs(nodes, radixAdapter().canvas)).toBe(
			'07e4b0a4876737182092f0f172c93e9fdd3c7fab1e7b4775cc577e27728e95ab'
		)
	})

	it('draws radix filled rather than stroked', async () => {
		const { nodes } = await import('./radix/generated/nodes')
		const markup = renderToStaticMarkup(
			<DrawerGlyph canvas={radixAdapter().canvas} nodes={nodes.check ?? []} size={24} />
		)
		expect(markup).toContain('viewBox="0 0 15 15"')
		expect(markup).toContain('stroke="none"')
		expect(markup).toContain('fill="currentColor"')
	})

	// Diagnosable companion to the hashes: names the exact markup a drawer cell emits,
	// including the stroke canvas the glyph is drawn on.
	it('emits the documented outline canvas for one known glyph', async () => {
		const { nodes } = await import('./lucide/generated/nodes')
		const house = nodes.house
		expect(house).toBeDefined()
		const markup = renderToStaticMarkup(<DrawerGlyph nodes={house ?? []} size={24} />)
		expect(markup).toContain('viewBox="0 0 24 24"')
		expect(markup).toContain('stroke="currentColor"')
		expect(markup).toContain('stroke-width="2"')
		expect(markup).toContain('fill="none"')
		expect(markup).toContain('stroke-linecap="round"')
		expect(markup).toContain('stroke-linejoin="round"')
		expect(markup).toContain('width="24"')
		expect(markup).toContain('height="24"')
	})

	it('resolves and renders a lucide sample identically', async () => {
		const { manifest } = await import('./lucide/generated/manifest')
		const names = sampleNames(
			manifest.icons.map((icon) => icon.name),
			12
		)
		const { hash, resolved } = await hashRendered(lucideRenderer(), names)
		expect(resolved).toBe(12)
		expect(hash).toBe('1031eca9507beddd50949b0cb758ac0193f02930848b0579a31ad96efeaea0c9')
	})

	it('resolves and renders a tabler sample identically', async () => {
		const { manifest } = await import('./tabler/generated/manifest')
		const names = sampleNames(
			manifest.icons.map((icon) => icon.name),
			12
		)
		const { hash, resolved } = await hashRendered(tablerRenderer(), names)
		expect(resolved).toBe(12)
		expect(hash).toBe('702894bd14b496a165d4ac2e68d00e6ce3c32a15d33da6f2cc9bf701b158d746')
	})

	it('resolves and renders a radix sample identically', async () => {
		const { manifest } = await import('./radix/generated/manifest')
		const names = sampleNames(
			manifest.icons.map((icon) => icon.name),
			12
		)
		const { hash, resolved } = await hashRendered(radixRenderer(), names)
		expect(resolved).toBe(12)
		expect(hash).toBe('3f164ca7200e46301c42a560c48828d98e3e941b146929626388e7aabae278c5')
	})
})

describe('bundled library labels stay derived', () => {
	const libraries: [string, () => Promise<{ manifest: IconManifest }>][] = [
		['lucide', () => import('./lucide/generated/manifest')],
		['radix', () => import('./radix/generated/manifest')],
		['tabler', () => import('./tabler/generated/manifest')],
	]

	// If a bundled manifest ever gained a label, every label in that library would change
	// at once. Asserting their absence is what keeps the new field additive in practice.
	it.each(libraries)('%s supplies no per-icon label', async (_slug, load) => {
		const { manifest } = await load()
		expect(manifest.icons.filter((icon) => icon.label !== undefined)).toEqual([])
	})

	it.each(libraries)('%s labels derive from the name, with no code shown', async (_slug, load) => {
		const { manifest } = await load()
		for (const icon of manifest.icons) {
			const display = resolveIconDisplay({ language: 'en', meta: icon, name: icon.name })
			expect(display.code).toBeUndefined()
			expect(display.label).toBe(
				icon.name
					.replace(/[-\s]+/g, ' ')
					.trim()
					.charAt(0)
					.toUpperCase() +
					icon.name
						.replace(/[-\s]+/g, ' ')
						.trim()
						.slice(1)
						.toLowerCase()
			)
		}
	})
})
