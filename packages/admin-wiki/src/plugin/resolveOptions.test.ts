import { describe, expect, it } from 'vitest'

import { resolveOptions } from './resolveOptions'

describe('resolveOptions', () => {
	it('applies defaults', () => {
		expect(resolveOptions({})).toEqual({
			editorBlocks: [],
			localeMap: {},
			slugs: { media: 'wiki-media', pages: 'wiki-pages' },
			triggers: {
				edit: 'beforeDocumentControls',
				global: 'beforeDocumentControls',
				list: 'actions',
			},
			video: false,
			wikiView: true,
		})
	})

	it('normalizes video: true to an empty options object', () => {
		expect(resolveOptions({ video: true }).video).toEqual({})
	})

	it('keeps video options and player component', () => {
		expect(resolveOptions({ video: { playerComponent: '/x#Player' } }).video).toEqual({
			playerComponent: '/x#Player',
		})
	})

	it('honors slug, trigger, and view overrides', () => {
		const resolved = resolveOptions({
			slugs: { pages: 'guides' },
			triggers: { edit: false, list: 'menu' },
			wikiView: false,
		})
		expect(resolved.slugs).toEqual({ media: 'wiki-media', pages: 'guides' })
		expect(resolved.triggers).toEqual({
			edit: false,
			global: 'beforeDocumentControls',
			list: 'menu',
		})
		expect(resolved.wikiView).toBe(false)
	})
})
