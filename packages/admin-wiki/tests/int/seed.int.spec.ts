import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionSlug } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { adminWiki, seedWiki } from '../../src/index'
import type { WikiSeedGuideDef } from '../../src/seed/types'
import { fixtureCollections, fixtureConfig, lexicalNode, lexicalText } from './fixtures'

const PAGES = 'wiki-pages' as CollectionSlug

/**
 * `seedWiki` against a real Payload: the parts that only exist once documents
 * are written. Idempotency, the two-pass ordering that lets one guide link to
 * another seeded in the same run, and the localized writes are all invisible to
 * a unit test of the transformers, which is where the content rewriting itself
 * is covered.
 *
 * Media seeding is deliberately absent: it uploads through the wiki media
 * collection, whose static directory is the package folder, and the placeholder
 * rewriting it feeds is unit tested in `src/seed/transformers`.
 */
describeForDb('seedWiki', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: fixtureCollections,
			configOverrides: fixtureConfig,
			db,
			// An unnamed tab writes its fields at the document root, which is what
			// gives `additionalData` a field to reach that the plugin does not own.
			plugin: adminWiki({
				overrides: {
					pages: { tabs: [{ fields: [{ name: 'audience', type: 'text' }], label: 'Editorial' }] },
				},
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const guideBySlug = async (slug: string, locale?: string) => {
		const result = await booted.payload.find({
			collection: PAGES,
			depth: 0,
			draft: true,
			pagination: false,
			...(locale ? { locale } : {}),
			where: { slug: { equals: slug } },
		})
		return result.docs as Array<Record<string, unknown>>
	}

	const seed = (guides: WikiSeedGuideDef[], options?: Parameters<typeof seedWiki>[2]) =>
		seedWiki(booted.payload, guides, options)

	it('creates a published guide carrying its four target lists', async () => {
		const result = await seed([
			{
				content: { markdown: '## Heading\n\nBody text.' },
				slug: 'created-guide',
				summary: 'What this guide is about.',
				targets: {
					blocks: ['hero'],
					collections: ['posts'],
					fields: ['collection:posts.title'],
					globals: ['settings'],
				},
				title: 'Created guide',
			},
		])

		expect(result.guides).toHaveLength(1)
		expect(result.guides[0]?.action).toBe('created')

		const [doc] = await guideBySlug('created-guide')
		expect(doc?._status).toBe('published')
		expect(doc?.title).toBe('Created guide')
		expect(doc?.summary).toBe('What this guide is about.')
		expect(doc?.targetBlocks).toEqual(['hero'])
		expect(doc?.targetCollections).toEqual(['posts'])
		expect(doc?.targetFields).toEqual(['collection:posts.title'])
		expect(doc?.targetGlobals).toEqual(['settings'])
	})

	it('converts markdown through the wiki editor', async () => {
		await seed([
			{
				content: { markdown: '## A heading\n\nA paragraph.' },
				slug: 'markdown-guide',
				title: 'Markdown guide',
			},
		])

		const [doc] = await guideBySlug('markdown-guide')
		const heading = lexicalNode(doc?.content, (node) => node.type === 'heading')
		expect(heading?.tag).toBe('h2')
		expect(lexicalText(doc?.content)).toContain('A paragraph.')
	})

	it('rewrites a GitHub alert into the plugin callout block', async () => {
		await seed([
			{
				content: { markdown: '> [!TIP]\n> Draft first.' },
				slug: 'callout-guide',
				title: 'Callout guide',
			},
		])

		const [doc] = await guideBySlug('callout-guide')
		const block = lexicalNode(doc?.content, (node) => node.type === 'block')
		expect((block?.fields as Record<string, unknown>)?.blockType).toBe('wikiCallout')
		expect((block?.fields as Record<string, unknown>)?.variant).toBe('tip')
	})

	it('updates the same document on a second run instead of duplicating', async () => {
		const def: WikiSeedGuideDef = {
			content: { markdown: 'First body.' },
			slug: 'idempotent-guide',
			title: 'Idempotent guide',
		}
		const first = await seed([def])
		const second = await seed([{ ...def, content: { markdown: 'Second body.' } }])

		expect(first.guides[0]?.action).toBe('created')
		expect(second.guides[0]?.action).toBe('updated')
		expect(String(second.guides[0]?.id)).toBe(String(first.guides[0]?.id))

		const docs = await guideBySlug('idempotent-guide')
		expect(docs).toHaveLength(1)
		expect(lexicalText(docs[0]?.content)).toContain('Second body.')
	})

	it('clears a target dropped between runs', async () => {
		const def: WikiSeedGuideDef = {
			content: { markdown: 'Body.' },
			slug: 'dropped-target-guide',
			title: 'Dropped target guide',
		}
		await seed([
			{ ...def, targets: { collections: ['posts'], fields: ['collection:posts.title'] } },
		])
		await seed([{ ...def, targets: { collections: ['posts'] } }])

		const [doc] = await guideBySlug('dropped-target-guide')
		expect(doc?.targetCollections).toEqual(['posts'])
		// Written on every run rather than merged, so a target removed from the
		// seed leaves the document rather than lingering.
		expect(doc?.targetFields).toEqual([])
	})

	it('writes every locale of a localized guide', async () => {
		await seed([
			{
				content: { de: { markdown: 'Deutscher Text.' }, en: { markdown: 'English text.' } },
				slug: 'localized-guide',
				summary: { de: 'Deutsche Zusammenfassung', en: 'English summary' },
				title: { de: 'Lokalisierter Leitfaden', en: 'Localized guide' },
			},
		])

		const [en] = await guideBySlug('localized-guide', 'en')
		const [de] = await guideBySlug('localized-guide', 'de')
		expect(en?.title).toBe('Localized guide')
		expect(de?.title).toBe('Lokalisierter Leitfaden')
		expect(de?.summary).toBe('Deutsche Zusammenfassung')
		expect(lexicalText(en?.content)).toContain('English text.')
		expect(lexicalText(de?.content)).toContain('Deutscher Text.')
	})

	it('leaves an unpublished guide as a draft', async () => {
		await seed([
			{
				content: { markdown: 'Not ready.' },
				publish: false,
				slug: 'draft-guide',
				title: 'Draft guide',
			},
		])

		const [doc] = await guideBySlug('draft-guide')
		expect(doc?._status).toBe('draft')

		const published = await booted.payload.find({
			collection: PAGES,
			pagination: false,
			where: { and: [{ slug: { equals: 'draft-guide' } }, { _status: { equals: 'published' } }] },
		})
		expect(published.docs).toHaveLength(0)
	})

	it('resolves a guide link to a guide seeded later in the same run', async () => {
		// The ensure pass creates every guide before any content is written, which
		// is what lets a guide link forward to one declared after it.
		const result = await seed([
			{
				content: { markdown: 'See {{wiki:guide:link-target}} for the rest.' },
				slug: 'link-source',
				title: 'Link source',
			},
			{ content: { markdown: 'The target.' }, slug: 'link-target', title: 'Link target' },
		])

		const targetId = result.guides.find((guide) => guide.slug === 'link-target')?.id
		const [doc] = await guideBySlug('link-source')
		const link = lexicalNode(doc?.content, (node) => node.type === 'inlineBlock')
		const fields = link?.fields as Record<string, unknown>
		expect(fields?.blockType).toBe('wikiGuideLink')
		expect(String(fields?.guide)).toBe(String(targetId))
	})

	it('fails loudly on a link to an unknown guide, naming the guide that carries it', async () => {
		await expect(
			seed([
				{
					content: { markdown: 'See {{wiki:guide:not-seeded}}.' },
					slug: 'broken-link-guide',
					title: 'Broken link guide',
				},
			])
		).rejects.toThrow(/broken-link-guide/)
	})

	it('writes a field the project added to the collection', async () => {
		await seed([
			{
				additionalData: { audience: 'editors' },
				content: { markdown: 'Body.' },
				slug: 'additional-data-guide',
				title: 'Additional data guide',
			},
		])

		const [doc] = await guideBySlug('additional-data-guide')
		expect(doc?.audience).toBe('editors')
	})

	it('resolves the function form against the running payload', async () => {
		await seed([
			{
				// The whole reason the function form exists: a value that is not known
				// until something has been read off the instance.
				additionalData: async (instance) => {
					const { totalDocs } = await instance.count({ collection: PAGES })
					return { audience: totalDocs > 0 ? 'not the first guide' : 'the first guide' }
				},
				content: { markdown: 'Body.' },
				slug: 'resolved-data-guide',
				title: 'Resolved data guide',
			},
		])

		const [doc] = await guideBySlug('resolved-data-guide')
		expect(doc?.audience).toBe('not the first guide')
	})

	it('refuses to write a field the seed owns, naming the guide and the field', async () => {
		const error = await seed([
			{
				additionalData: { slug: 'hijacked' },
				content: { markdown: 'Body.' },
				slug: 'reserved-data-guide',
				title: 'Reserved data guide',
			},
		]).catch((thrown: unknown) => thrown)

		// Every guide failure is wrapped with the guide it happened on, so what
		// went wrong is one level down, on the cause.
		expect(String(error)).toMatch(/reserved-data-guide/)
		expect(String((error as { cause?: unknown }).cause)).toMatch(/slug/)
	})

	it('runs a consumer transformer after the built-in pipeline', async () => {
		const seen: string[] = []
		await seed(
			[
				{
					content: { markdown: '> [!NOTE]\n> Converted before the consumer sees it.' },
					slug: 'transformer-guide',
					title: 'Transformer guide',
				},
			],
			{
				transformers: [
					(state) => {
						const children = (state.root as unknown as { children: Array<{ type: string }> })
							.children
						seen.push(...children.map((child) => child.type))
						return state
					},
				],
			}
		)

		// The built-in alert transformer already turned the quote into a block, so
		// a consumer transformer sees the rewritten state rather than the raw one.
		expect(seen).toContain('block')
		expect(seen).not.toContain('quote')
	})
})
