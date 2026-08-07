import type { CollectionConfig, Config, GlobalConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { registerTriggers } from './registerTriggers'
import { resolveOptions } from './resolveOptions'

const makeConfig = (): Config =>
	({
		collections: [
			{ fields: [], slug: 'posts' },
			{ fields: [], slug: 'wiki-pages' },
		],
		globals: [{ fields: [], slug: 'settings' }],
	}) as unknown as Config

type AnyComponents = {
	beforeListTable?: unknown[]
	edit?: { beforeDocumentControls?: unknown[]; editMenuItems?: unknown[] }
	elements?: { beforeDocumentControls?: unknown[] }
	listMenuItems?: unknown[]
	views?: { list?: { actions?: unknown[] } }
}

const componentsOf = (entity: CollectionConfig | GlobalConfig): AnyComponents =>
	(entity.admin?.components ?? {}) as AnyComponents

describe('registerTriggers', () => {
	it('registers defaults: list actions + beforeDocumentControls, globals included', () => {
		const config = makeConfig()
		registerTriggers(config, resolveOptions({}))
		const posts = componentsOf((config.collections ?? [])[0] as CollectionConfig)
		expect(posts.views?.list?.actions).toHaveLength(1)
		expect(posts.edit?.beforeDocumentControls).toHaveLength(1)
		const settings = componentsOf((config.globals ?? [])[0] as GlobalConfig)
		expect(settings.elements?.beforeDocumentControls).toHaveLength(1)
	})

	it('skips the wiki collections', () => {
		const config = makeConfig()
		registerTriggers(config, resolveOptions({}))
		const wiki = componentsOf((config.collections ?? [])[1] as CollectionConfig)
		expect(wiki.views?.list?.actions).toBeUndefined()
		expect(wiki.edit).toBeUndefined()
	})

	it('honors menu slots and disabled surfaces', () => {
		const config = makeConfig()
		registerTriggers(
			config,
			resolveOptions({ triggers: { edit: 'menu', global: false, list: 'menu' } })
		)
		const posts = componentsOf((config.collections ?? [])[0] as CollectionConfig)
		expect(posts.listMenuItems).toHaveLength(1)
		expect(posts.edit?.editMenuItems).toHaveLength(1)
		expect(posts.views).toBeUndefined()
		const settings = componentsOf((config.globals ?? [])[0] as GlobalConfig)
		expect(settings.elements).toBeUndefined()
	})
})
