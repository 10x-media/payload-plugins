import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig, type Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { ADMIN_WIKI_PLUGIN_ORDER, adminWiki, getWikiRegistry } from '../../src/index'

/**
 * Payload behaviour the plugin relies on: plugins run sorted by `order`, not in
 * array order. Sanitizing never connects, so the adapter's URL is never used.
 */
describe('adminWiki plugin order', () => {
	it('documents a collection added by a plugin registered after it', async () => {
		const addsCollection = (config: Config): Config => ({
			...config,
			collections: [
				...(config.collections ?? []),
				{ slug: 'late', fields: [{ name: 'headline', type: 'text' }] },
			],
		})
		const config = await buildConfig({
			collections: [{ slug: 'users', auth: true, fields: [] }],
			db: mongooseAdapter({ url: 'mongodb://127.0.0.1:1/never-connected' }),
			plugins: [adminWiki({}), addsCollection],
			secret: 'test-secret',
			telemetry: false,
		})

		expect(ADMIN_WIKI_PLUGIN_ORDER).toBeGreaterThan(0)
		expect(getWikiRegistry(config)?.validTargetKeys).toEqual(
			expect.arrayContaining(['collection:late', 'field:collection:late.headline'])
		)
	})

	it('runs at the order the host passes, so a later plugin sees the wiki collections', async () => {
		let seen: string[] = []
		const needsWikiMedia = Object.assign(
			(config: Config): Config => {
				seen = (config.collections ?? []).map((collection) => collection.slug)
				return config
			},
			{ order: 10 }
		)
		const plugin = adminWiki({ order: 0 })
		await buildConfig({
			collections: [{ slug: 'users', auth: true, fields: [] }],
			db: mongooseAdapter({ url: 'mongodb://127.0.0.1:1/never-connected' }),
			plugins: [needsWikiMedia, plugin],
			secret: 'test-secret',
			telemetry: false,
		})

		expect(plugin.order).toBe(0)
		expect(seen).toEqual(expect.arrayContaining(['wiki-pages', 'wiki-media']))
	})

	it('keeps the default order when none is passed', () => {
		expect(adminWiki({}).order).toBe(ADMIN_WIKI_PLUGIN_ORDER)
		expect(adminWiki().order).toBe(ADMIN_WIKI_PLUGIN_ORDER)
	})
})
