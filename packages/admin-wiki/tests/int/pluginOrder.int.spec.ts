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
})
