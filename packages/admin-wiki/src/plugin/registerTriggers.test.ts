import type { CollectionConfig, Config, CustomComponent, Field, GlobalConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { registerTriggers, WIKI_GUIDES_FIELD } from './registerTriggers'
import { resolveOptions } from './resolveOptions'

const makeConfig = (): Config =>
	({
		collections: [
			{ fields: [], slug: 'posts' },
			{ fields: [], slug: 'wiki-pages' },
		],
		globals: [{ fields: [], slug: 'settings' }],
	}) as unknown as Config

const entityOf = (config: Config, slug: string): CollectionConfig | GlobalConfig =>
	[...(config.collections ?? []), ...(config.globals ?? [])].find(
		(entity) => entity.slug === slug
	) as CollectionConfig | GlobalConfig

const bandOf = (config: Config, slug: string, slot: string): CustomComponent[] | undefined =>
	(entityOf(config, slug) as CollectionConfig).admin?.components?.[slot as 'afterListTable'] as
		| CustomComponent[]
		| undefined

const panelOf = (config: Config, slug: string): Field | undefined =>
	entityOf(config, slug).fields.find((field) => 'name' in field && field.name === WIKI_GUIDES_FIELD)

describe('registerTriggers', () => {
	it('registers the band on collection lists, keyed per collection', () => {
		const config = makeConfig()
		registerTriggers(config, resolveOptions({}))
		const band = bandOf(config, 'posts', 'afterListTable')
		expect(band).toHaveLength(1)
		expect(band?.[0]).toEqual({
			clientProps: { featured: true, slot: 'afterListTable', targetKey: 'collection:posts' },
			path: '@10x-media/admin-wiki/client#WikiListGuides',
		})
	})

	it('registers the guides panel as a sidebar UI field on collections and globals', () => {
		const config = makeConfig()
		registerTriggers(config, resolveOptions({}))
		const cases: Array<[string, string]> = [
			['posts', 'collection:posts'],
			['settings', 'global:settings'],
		]
		for (const [slug, targetKey] of cases) {
			expect(panelOf(config, slug)).toEqual({
				name: WIKI_GUIDES_FIELD,
				type: 'ui',
				admin: {
					components: {
						Field: {
							clientProps: { targetKey },
							path: '@10x-media/admin-wiki/client#WikiDocumentGuides',
						},
					},
					disableListColumn: true,
					position: 'sidebar',
				},
			})
		}
	})

	it('skips the wiki collections', () => {
		const config = makeConfig()
		registerTriggers(config, resolveOptions({}))
		expect(bandOf(config, 'wiki-pages', 'afterListTable')).toBeUndefined()
		expect(panelOf(config, 'wiki-pages')).toBeUndefined()
	})

	it('honors the excluded slugs across every surface', () => {
		const config = makeConfig()
		registerTriggers(
			config,
			resolveOptions({ exclude: { collections: ['posts'], globals: ['settings'] } })
		)
		expect(bandOf(config, 'posts', 'afterListTable')).toBeUndefined()
		expect(panelOf(config, 'posts')).toBeUndefined()
		expect(panelOf(config, 'settings')).toBeUndefined()
	})

	it('keeps collection and global exclusions apart under a shared slug', () => {
		const config = makeConfig()
		const collection = (config.collections ?? [])[0] as CollectionConfig
		collection.slug = 'settings'
		const global = (config.globals ?? [])[0] as GlobalConfig
		registerTriggers(config, resolveOptions({ exclude: { globals: ['settings'] } }))
		const hasPanel = (entity: CollectionConfig | GlobalConfig) =>
			entity.fields.some((field) => 'name' in field && field.name === WIKI_GUIDES_FIELD)
		expect(hasPanel(collection)).toBe(true)
		expect(hasPanel(global)).toBe(false)
	})

	it('honors the band slot and disabled surfaces', () => {
		const config = makeConfig()
		registerTriggers(
			config,
			resolveOptions({ triggers: { edit: false, global: false, list: { slot: 'beforeList' } } })
		)
		expect(bandOf(config, 'posts', 'beforeList')).toHaveLength(1)
		expect(bandOf(config, 'posts', 'afterListTable')).toBeUndefined()
		expect(panelOf(config, 'posts')).toBeUndefined()
		expect(panelOf(config, 'settings')).toBeUndefined()
	})

	it('passes the featured flag through to the band', () => {
		const config = makeConfig()
		registerTriggers(config, resolveOptions({ featured: false }))
		const band = bandOf(config, 'posts', 'afterListTable')
		expect((band?.[0] as { clientProps: { featured: boolean } }).clientProps.featured).toBe(false)
	})

	it('leaves a host field named like the panel alone', () => {
		const config = makeConfig()
		const posts = (config.collections ?? [])[0] as CollectionConfig
		posts.fields = [{ name: WIKI_GUIDES_FIELD, type: 'text' }]
		registerTriggers(config, resolveOptions({}))
		expect(posts.fields).toHaveLength(1)
		expect(posts.fields[0]?.type).toBe('text')
	})
})
