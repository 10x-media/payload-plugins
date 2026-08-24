import { describe, expect, it } from 'vitest'

import type { WikiEditorFeature } from '../options'
import { PAYLOAD_INTERNAL_COLLECTIONS, PAYLOAD_INTERNAL_GLOBALS } from './exclude'
import { resolveOptions } from './resolveOptions'

describe('resolveOptions', () => {
	it('applies defaults', () => {
		expect(resolveOptions({})).toEqual({
			chips: { blocks: true },
			customTargets: [],
			editorBlocks: [],
			editorConverters: undefined,
			editorFeatures: undefined,
			editorInlineBlocks: [],
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
			wikiView: { components: { afterTable: [], beforeControls: [], beforeTable: [] } },
			writeAffordances: 'editMode',
		})
	})

	it('normalizes declared custom targets and labels every one', () => {
		expect(
			resolveOptions({
				customTargets: [
					'traffic',
					{ key: ' dashboard ', label: { de: 'Übersicht', en: 'Dashboard' } },
					{ key: 'custom:dashboard.attention' },
				],
			}).customTargets
		).toEqual([
			{ key: 'traffic', label: 'traffic' },
			{ key: 'dashboard', label: { de: 'Übersicht', en: 'Dashboard' } },
			{ key: 'dashboard.attention', label: 'dashboard.attention' },
		])
	})

	it('drops blank keys and keeps the first declaration of a repeated one', () => {
		expect(
			resolveOptions({
				customTargets: ['', '   ', { key: 'dashboard', label: 'First' }, { key: 'dashboard' }],
			}).customTargets
		).toEqual([{ key: 'dashboard', label: 'First' }])
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

	it('fills the wiki view slots that were left out', () => {
		const resolved = resolveOptions({
			wikiView: { components: { beforeControls: ['/x#Export'] } },
		})
		expect(resolved.wikiView).toEqual({
			components: { afterTable: [], beforeControls: ['/x#Export'], beforeTable: [] },
		})
	})

	it('keeps the slots empty for the wiki view shorthands', () => {
		const empty = { afterTable: [], beforeControls: [], beforeTable: [] }
		expect(resolveOptions({ wikiView: true }).wikiView).toEqual({ components: empty })
		expect(resolveOptions({ wikiView: {} }).wikiView).toEqual({ components: empty })
	})

	it('passes editor features through in whichever form they arrived', () => {
		// Left alone on purpose: normalizing the array into a function here would
		// need the plugin's own feature list, which only `buildWikiEditor` has.
		const array: WikiEditorFeature[] = []
		expect(resolveOptions({ editor: { features: array } }).editorFeatures).toBe(array)

		const fn = ({ defaultFeatures }: { defaultFeatures: WikiEditorFeature[] }) => defaultFeatures
		expect(resolveOptions({ editor: { features: fn } }).editorFeatures).toBe(fn)
	})

	it('keeps blocks and inline blocks apart', () => {
		const block = { block: { slug: 'tip', fields: [] }, component: '/Tip#Tip' }
		const inline = { block: { slug: 'chip', fields: [] }, component: '/Chip#Chip' }
		const resolved = resolveOptions({ editor: { blocks: [block], inlineBlocks: [inline] } })
		expect(resolved.editorBlocks).toEqual([block])
		expect(resolved.editorInlineBlocks).toEqual([inline])
	})

	it('carries the converters path through untouched', () => {
		expect(
			resolveOptions({ editor: { converters: '/converters#wikiConverters' } }).editorConverters
		).toBe('/converters#wikiConverters')
	})

	it('honors the block chips opt-out', () => {
		expect(resolveOptions({ chips: { blocks: false } }).chips).toEqual({ blocks: false })
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
