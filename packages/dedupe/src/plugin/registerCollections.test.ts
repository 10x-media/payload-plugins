import type { Config } from 'payload'
import { describe, expect, it } from 'vitest'

import { PAIRS_SLUG } from '../collections/slugs'
import { resolveOptions } from '../options'
import { keysAdapter } from '../search/keysAdapter'
import { registerCollections } from './registerCollections'

describe('registerCollections', () => {
	it('applies an override and forces the slug back', () => {
		const config = { collections: [] } as unknown as Config
		registerCollections(
			config,
			resolveOptions({
				overrides: {
					pairs: (collection) => ({
						...collection,
						slug: 'renamed',
						labels: { singular: 'Pair', plural: 'Pairs' },
					}),
				},
			})
		)
		const pairs = config.collections?.find((collection) => collection.slug === PAIRS_SLUG)
		expect(pairs?.labels).toEqual({ singular: 'Pair', plural: 'Pairs' })
	})

	it('refuses hooks on the plugin collections', () => {
		const config = { collections: [] } as unknown as Config
		expect(() =>
			registerCollections(
				config,
				resolveOptions({
					overrides: {
						pairs: (collection) => ({ ...collection, hooks: { afterChange: [() => undefined] } }),
					},
				})
			)
		).toThrow(/hooks on "dedupe-pairs" are not supported/)
	})

	it('lets the built-in adapter bring the keys collection through the same override', () => {
		const config = { collections: [] } as unknown as Config
		expect(() =>
			keysAdapter({
				read: () => false,
				override: (collection) => ({ ...collection, hooks: { afterChange: [() => undefined] } }),
			}).register?.(config)
		).toThrow(/hooks on "dedupe-keys" are not supported/)
	})
})
