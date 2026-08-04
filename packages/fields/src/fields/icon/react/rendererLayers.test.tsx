import type { ComponentType, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createRscIcon } from './createRscIcon'
import type { IconRendererAdapter, IconRenderProps } from './types'

const Glyph =
	(label: string): ComponentType<IconRenderProps> =>
	() => <svg data-glyph={label} />

const markupOf = (node: ReactNode): string => renderToStaticMarkup(node)

describe('renderer layers', () => {
	// The shape paddle ships: a static package plus overrides resolved on the frontend.
	it('prefers the last layer that resolves a name', async () => {
		const adapter: IconRendererAdapter = {
			slug: 'flag',
			layers: [
				{ loadIcon: async () => Glyph('base') },
				{ loadIcon: async (name) => (name === 'HUN' ? Glyph('override') : null) },
			],
			loadIcon: async () => null,
		}
		const Icon = createRscIcon({ adapters: [adapter] })
		expect(markupOf(await Icon({ icon: 'flag:HUN' }))).toContain('override')
	})

	it('falls through to an older layer for a name the override lacks', async () => {
		const adapter: IconRendererAdapter = {
			slug: 'flag',
			layers: [
				{ loadIcon: async () => Glyph('base') },
				{ loadIcon: async (name) => (name === 'HUN' ? Glyph('override') : null) },
			],
			loadIcon: async () => null,
		}
		const Icon = createRscIcon({ adapters: [adapter] })
		expect(markupOf(await Icon({ icon: 'flag:SUI' }))).toContain('base')
	})

	it('renders the caller fallback when no layer has the name', async () => {
		const adapter: IconRendererAdapter = {
			slug: 'flag',
			layers: [{ loadIcon: async () => null }],
			loadIcon: async () => null,
		}
		const Icon = createRscIcon({ adapters: [adapter] })
		expect(await Icon({ fallback: 'FB', icon: 'flag:none' })).toBe('FB')
	})

	// Every renderer written before layers existed has none and must keep using loadIcon.
	it('uses the adapter loadIcon when no layers are declared', async () => {
		const loadIcon = vi.fn(async () => Glyph('flat'))
		const Icon = createRscIcon({ adapters: [{ loadIcon, slug: 'flat' }] })
		expect(markupOf(await Icon({ icon: 'flat:x' }))).toContain('flat')
		expect(loadIcon).toHaveBeenCalledTimes(1)
	})

	it('caches a layered resolution, so a repeated value asks each layer once', async () => {
		const base = vi.fn(async () => Glyph('base'))
		const adapter: IconRendererAdapter = {
			slug: 'flag',
			layers: [{ loadIcon: base }],
			loadIcon: async () => null,
		}
		const Icon = createRscIcon({ adapters: [adapter] })
		await Icon({ icon: 'flag:HUN' })
		await Icon({ icon: 'flag:HUN' })
		expect(base).toHaveBeenCalledTimes(1)
	})
})
