import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { adminWiki, seedWiki } from '../../src/index'
import { fixtureCollections, fixtureConfig, lexicalText } from './fixtures'

const PAGES = 'wiki-pages' as CollectionSlug

/**
 * The plugin's own collection is the part with a schema: drafts, a localized
 * rich text field, and four `hasMany` text lists. Seeding one guide and reading
 * it back exercises all of them on both databases, which is where a Postgres
 * column or relation problem would surface and Mongo would not.
 */
describeForDb('adminWiki cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: fixtureCollections,
			configOverrides: fixtureConfig,
			db,
			plugin: adminWiki({}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`boots against ${db}`, () => {
		expect(booted.payload).toBeDefined()
		expect(booted.db).toBe(db)
	})

	it(`stores a seeded guide, its targets, and both locales against ${db}`, async () => {
		await seedWiki(booted.payload, [
			{
				content: { de: { markdown: 'Deutscher Text.' }, en: { markdown: 'English text.' } },
				featured: true,
				featuredOrder: 1,
				slug: 'matrix-guide',
				summary: 'Cross-database guide.',
				targets: {
					blocks: ['hero'],
					collections: ['posts'],
					fields: ['collection:posts.title'],
					globals: ['settings'],
				},
				title: { de: 'Matrix-Leitfaden', en: 'Matrix guide' },
			},
		])

		const read = async (locale: string) => {
			const result = await booted.payload.find({
				collection: PAGES,
				depth: 0,
				locale,
				pagination: false,
				where: { slug: { equals: 'matrix-guide' } },
			})
			return result.docs[0] as undefined | Record<string, unknown>
		}

		const en = await read('en')
		expect(en?._status).toBe('published')
		expect(en?.featured).toBe(true)
		expect(en?.title).toBe('Matrix guide')
		expect(en?.targetBlocks).toEqual(['hero'])
		expect(en?.targetCollections).toEqual(['posts'])
		expect(en?.targetFields).toEqual(['collection:posts.title'])
		expect(en?.targetGlobals).toEqual(['settings'])
		expect(lexicalText(en?.content)).toContain('English text.')

		const de = await read('de')
		expect(de?.title).toBe('Matrix-Leitfaden')
		expect(lexicalText(de?.content)).toContain('Deutscher Text.')
	})
})
