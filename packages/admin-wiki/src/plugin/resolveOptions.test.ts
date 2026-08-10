import { describe, expect, it } from 'vitest'

import { PAYLOAD_INTERNAL_COLLECTIONS, PAYLOAD_INTERNAL_GLOBALS } from './exclude'
import { resolveOptions } from './resolveOptions'

describe('resolveOptions', () => {
	it('applies defaults', () => {
		expect(resolveOptions({})).toEqual({
			editorBlocks: [],
			exclude: {
				blocks: [],
				collections: [...PAYLOAD_INTERNAL_COLLECTIONS, 'wiki-media', 'wiki-pages'].sort(),
				globals: [...PAYLOAD_INTERNAL_GLOBALS],
			},
			featured: true,
			localeMap: {},
			slugs: { media: 'wiki-media', pages: 'wiki-pages' },
			triggers: {
				edit: true,
				global: true,
				list: { slot: 'afterListTable' },
			},
			video: false,
			wikiView: true,
			writeAffordances: 'editMode',
		})
	})

	it('merges the host exclusions into the built-ins, per entity kind', () => {
		const { exclude } = resolveOptions({
			exclude: { blocks: ['hero'], collections: ['users'], globals: ['nav'] },
		})
		expect(exclude.blocks).toEqual(['hero'])
		expect(exclude.collections).toContain('users')
		expect(exclude.collections).toContain('payload-preferences')
		expect(exclude.globals).toEqual(['nav', ...PAYLOAD_INTERNAL_GLOBALS].sort())
	})

	it('keeps a slug shared by a collection and a global apart', () => {
		const { exclude } = resolveOptions({ exclude: { collections: ['settings'] } })
		expect(exclude.collections).toContain('settings')
		expect(exclude.globals).not.toContain('settings')
	})

	it('excludes the wiki collections under overridden slugs', () => {
		const { exclude } = resolveOptions({ slugs: { media: 'guide-media', pages: 'guides' } })
		expect(exclude.collections).toContain('guides')
		expect(exclude.collections).toContain('guide-media')
		expect(exclude.collections).not.toContain('wiki-pages')
	})

	it('normalizes the list band shorthands', () => {
		expect(resolveOptions({ triggers: { list: true } }).triggers.list).toEqual({
			slot: 'afterListTable',
		})
		expect(resolveOptions({ triggers: { list: { slot: 'beforeList' } } }).triggers.list).toEqual({
			slot: 'beforeList',
		})
		expect(resolveOptions({ triggers: { list: false } }).triggers.list).toBe(false)
	})

	it('honors the featured flag', () => {
		expect(resolveOptions({ featured: false }).featured).toBe(false)
	})

	it('honors the write affordance mode', () => {
		expect(resolveOptions({ writeAffordances: 'never' }).writeAffordances).toBe('never')
		expect(resolveOptions({ writeAffordances: 'always' }).writeAffordances).toBe('always')
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
			triggers: { edit: false },
			wikiView: false,
		})
		expect(resolved.slugs).toEqual({ media: 'wiki-media', pages: 'guides' })
		expect(resolved.triggers).toEqual({
			edit: false,
			global: true,
			list: { slot: 'afterListTable' },
		})
		expect(resolved.wikiView).toBe(false)
	})
})
