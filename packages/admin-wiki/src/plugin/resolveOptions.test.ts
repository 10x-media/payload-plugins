import { describe, expect, it } from 'vitest'

import { resolveOptions } from './resolveOptions'

describe('resolveOptions', () => {
	it('applies defaults', () => {
		expect(resolveOptions({})).toEqual({
			editorBlocks: [],
			featured: true,
			localeMap: {},
			slugs: { media: 'wiki-media', pages: 'wiki-pages' },
			triggers: {
				edit: true,
				exclude: [],
				global: true,
				list: { slot: 'afterListTable' },
			},
			video: false,
			wikiView: true,
			writeAffordances: 'editMode',
		})
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
			triggers: { edit: false, exclude: ['users'] },
			wikiView: false,
		})
		expect(resolved.slugs).toEqual({ media: 'wiki-media', pages: 'guides' })
		expect(resolved.triggers).toEqual({
			edit: false,
			exclude: ['users'],
			global: true,
			list: { slot: 'afterListTable' },
		})
		expect(resolved.wikiView).toBe(false)
	})
})
