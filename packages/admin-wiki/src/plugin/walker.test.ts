import type { CollectionConfig, Config, Field, GlobalConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveOptions } from './resolveOptions'
import { WIKI_BLOCK_HELP_FIELD, walkAndInjectFieldHelp } from './walker'

const resolved = resolveOptions({})

const makeConfig = (collections: CollectionConfig[], globals: GlobalConfig[] = []): Config =>
	({ collections, globals }) as unknown as Config

const descriptionOf = (field: Field): unknown =>
	(field as { admin?: { components?: { Description?: unknown } } }).admin?.components?.Description

describe('walkAndInjectFieldHelp', () => {
	it('injects into named fields and builds schema paths through containers', () => {
		const titleField: Field = { name: 'title', type: 'text' }
		const nestedField: Field = { name: 'headline', type: 'text' }
		const config = makeConfig([
			{
				slug: 'posts',
				fields: [
					titleField,
					{
						type: 'tabs',
						tabs: [
							{ label: 'Plain', fields: [{ name: 'plain', type: 'text' }] },
							{ name: 'meta', label: 'Meta', fields: [{ name: 'seoTitle', type: 'text' }] },
						],
					},
					{
						name: 'hero',
						type: 'group',
						fields: [{ type: 'row', fields: [nestedField] }],
					},
				],
			},
		])
		const result = walkAndInjectFieldHelp(config, resolved)
		expect(result.validTargetKeys).toContain('collection:posts')
		expect(result.validTargetKeys).toContain('field:collection:posts.title')
		expect(result.validTargetKeys).toContain('field:collection:posts.plain')
		expect(result.validTargetKeys).toContain('field:collection:posts.meta.seoTitle')
		expect(result.validTargetKeys).toContain('field:collection:posts.hero')
		expect(result.validTargetKeys).toContain('field:collection:posts.hero.headline')
		const injected = descriptionOf(titleField) as { clientProps: { schemaPath: string } }
		expect(injected.clientProps.schemaPath).toBe('collection:posts.title')
		expect(result.injectedFieldCount).toBe(5)
	})

	it('collects block slugs, walks block fields, and injects block help', () => {
		const ctaBlock = { slug: 'cta', fields: [{ name: 'label', type: 'text' }] as Field[] }
		const labeledBlock = {
			slug: 'custom',
			admin: { components: { Label: '/custom#Label' } },
			fields: [] as Field[],
		}
		const config = makeConfig([
			{
				slug: 'pages',
				fields: [
					{
						name: 'layout',
						type: 'blocks',
						blocks: [ctaBlock, labeledBlock],
					},
				],
			},
		])
		const result = walkAndInjectFieldHelp(config, resolved)
		expect(result.validTargetKeys).toContain('block:cta')
		expect(result.validTargetKeys).toContain('field:collection:pages.layout')
		expect(result.validTargetKeys).toContain('field:block:cta.label')
		expect(result.validTargetKeys).not.toContain('field:collection:pages.layout.cta.label')
		expect(result.blockSlugs).toEqual(['cta', 'custom'])
		expect(ctaBlock.fields[0]).toMatchObject({ name: 'label' })
		expect(ctaBlock.fields[1]).toMatchObject({
			name: WIKI_BLOCK_HELP_FIELD,
			type: 'ui',
			admin: { components: { Field: { clientProps: { blockSlug: 'cta' } } } },
		})
	})

	it('gives a shared block one key and one injection from every usage', () => {
		const heroBlock = { slug: 'hero', fields: [{ name: 'headline', type: 'text' }] as Field[] }
		const config = makeConfig(
			[
				{ slug: 'pages', fields: [{ name: 'layout', type: 'blocks', blocks: [heroBlock] }] },
				{ slug: 'posts', fields: [{ name: 'sections', type: 'blocks', blocks: [heroBlock] }] },
			],
			[{ slug: 'home', fields: [{ name: 'body', type: 'blocks', blocks: [heroBlock] }] }]
		)
		const result = walkAndInjectFieldHelp(config, resolved)
		expect(result.validTargetKeys.filter((key) => key.includes('hero'))).toEqual([
			'block:hero',
			'field:block:hero.headline',
		])
		const injected = descriptionOf(heroBlock.fields[0] as Field) as {
			clientProps: { schemaPath: string }
		}
		expect(injected.clientProps.schemaPath).toBe('block:hero.headline')
		expect(heroBlock.fields.filter((field) => 'name' in field)).toHaveLength(2)
		expect(result.warnings).toEqual([])
	})

	it('resolves blockReferences and roots a nested block at its own slug', () => {
		const innerBlock = { slug: 'inner', fields: [{ name: 'text', type: 'text' }] as Field[] }
		const outerBlock = {
			slug: 'outer',
			fields: [
				{ name: 'children', type: 'blocks', blocks: [], blockReferences: ['inner'] },
			] as Field[],
		}
		const config = {
			blocks: [innerBlock, outerBlock],
			collections: [
				{
					slug: 'pages',
					fields: [{ name: 'layout', type: 'blocks', blocks: [], blockReferences: ['outer'] }],
				},
			],
		} as unknown as Config
		const result = walkAndInjectFieldHelp(config, resolved)
		expect(result.validTargetKeys).toContain('field:collection:pages.layout')
		expect(result.validTargetKeys).toContain('field:block:outer.children')
		expect(result.validTargetKeys).toContain('field:block:inner.text')
		expect(result.validTargetKeys).not.toContain('field:block:outer.children.inner.text')
	})

	it('merges two blocks sharing a slug, helps both, and warns once about the divergence', () => {
		const registryBlock = {
			slug: 'quote',
			labels: { plural: 'Quotes', singular: 'Quote' },
			fields: [{ name: 'body', type: 'text' }] as Field[],
		}
		const inlineBlock = {
			slug: 'quote',
			labels: { plural: 'Inline quotes', singular: 'Inline quote' },
			fields: [
				{ name: 'body', type: 'text' },
				{ name: 'author', type: 'text' },
			] as Field[],
		}
		const config = {
			blocks: [registryBlock],
			collections: [
				{ slug: 'pages', fields: [{ name: 'layout', type: 'blocks', blocks: [inlineBlock] }] },
			],
		} as unknown as Config
		const result = walkAndInjectFieldHelp(config, resolved)
		expect(result.validTargetKeys).toContain('field:block:quote.body')
		expect(result.validTargetKeys).toContain('field:block:quote.author')
		expect(result.blockSlugs).toEqual(['quote'])
		expect(result.blockLabels.quote).toBe('Quote')
		expect(registryBlock.fields.at(-1)).toMatchObject({ name: WIKI_BLOCK_HELP_FIELD })
		expect(inlineBlock.fields.at(-1)).toMatchObject({ name: WIKI_BLOCK_HELP_FIELD })
		expect(result.warnings).toHaveLength(1)
		expect(result.warnings[0]).toContain('"quote"')
		expect(result.warnings[0]).toContain('config.blocks')
		expect(result.warnings[0]).toContain('collection:pages.layout')
	})

	it('stays quiet when two objects sharing a slug declare the same fields', () => {
		const first = { slug: 'quote', fields: [{ name: 'body', type: 'text' }] as Field[] }
		const second = { slug: 'quote', fields: [{ name: 'body', type: 'text' }] as Field[] }
		const config = makeConfig([
			{ slug: 'pages', fields: [{ name: 'layout', type: 'blocks', blocks: [first] }] },
			{ slug: 'posts', fields: [{ name: 'layout', type: 'blocks', blocks: [second] }] },
		])
		expect(walkAndInjectFieldHelp(config, resolved).warnings).toEqual([])
	})

	it('helps a block that declares its own row label, which the old slot could not', () => {
		const labeledBlock = {
			slug: 'custom',
			admin: { components: { Label: '/custom#Label' } },
			fields: [] as Field[],
		}
		const config = makeConfig([
			{ slug: 'pages', fields: [{ name: 'layout', type: 'blocks', blocks: [labeledBlock] }] },
		])
		walkAndInjectFieldHelp(config, resolved)
		expect(labeledBlock.fields.at(-1)).toMatchObject({ name: WIKI_BLOCK_HELP_FIELD })
		expect(labeledBlock.admin.components.Label).toBe('/custom#Label')
	})

	it('walks globals and skips the wiki collections', () => {
		const config = makeConfig(
			[{ slug: 'wiki-pages', fields: [{ name: 'title', type: 'text' }] }],
			[{ slug: 'settings', fields: [{ name: 'siteName', type: 'text' }] }]
		)
		const result = walkAndInjectFieldHelp(config, resolved)
		expect(result.validTargetKeys).toContain('global:settings')
		expect(result.validTargetKeys).toContain('field:global:settings.siteName')
		expect(result.validTargetKeys).not.toContain('collection:wiki-pages')
		expect(result.validTargetKeys).not.toContain('field:collection:wiki-pages.title')
	})

	it('keeps a collection and a global that share a slug apart', () => {
		const config = makeConfig(
			[{ slug: 'settings', fields: [{ name: 'siteName', type: 'text' }] }],
			[{ slug: 'settings', fields: [{ name: 'siteName', type: 'text' }] }]
		)
		const result = walkAndInjectFieldHelp(config, resolved)
		expect(result.validTargetKeys).toContain('field:collection:settings.siteName')
		expect(result.validTargetKeys).toContain('field:global:settings.siteName')
	})

	it('leaves excluded collections and globals entirely untouched', () => {
		const field: Field = { name: 'title', type: 'text' }
		const config = makeConfig(
			[{ slug: 'users', fields: [field] }],
			[{ slug: 'nav', fields: [{ name: 'label', type: 'text' }] }]
		)
		const result = walkAndInjectFieldHelp(
			config,
			resolveOptions({ exclude: { collections: ['users'], globals: ['nav'] } })
		)
		expect(descriptionOf(field)).toBeUndefined()
		expect(result.injectedFieldCount).toBe(0)
		expect(result.validTargetKeys).toEqual([])
	})

	it('excludes a block by its own list, not by the collection lists', () => {
		const ctaBlock = { slug: 'cta', fields: [{ name: 'label', type: 'text' }] as Field[] }
		const config = makeConfig([
			{ slug: 'pages', fields: [{ name: 'layout', type: 'blocks', blocks: [ctaBlock] }] },
		])
		const result = walkAndInjectFieldHelp(config, resolveOptions({ exclude: { blocks: ['cta'] } }))
		expect(result.validTargetKeys).not.toContain('block:cta')
		expect(result.validTargetKeys).not.toContain('field:block:cta.label')
		expect(result.blockSlugs).toEqual([])
		expect(ctaBlock.fields).toHaveLength(1)
	})

	it('preserves an existing static description and skips custom components', () => {
		const withStatic: Field = {
			name: 'a',
			type: 'text',
			admin: { description: 'keep me' },
		}
		const withComponent: Field = {
			name: 'b',
			type: 'text',
			admin: { components: { Description: '/custom#X' } },
		}
		const localized: Field = {
			name: 'c',
			type: 'text',
			admin: { description: { de: 'behalte mich', en: 'keep me' } },
		}
		const config = makeConfig([{ slug: 'posts', fields: [withStatic, withComponent, localized] }])
		const result = walkAndInjectFieldHelp(config, resolved)
		const injected = descriptionOf(withStatic) as { clientProps: { description: unknown } }
		expect(injected.clientProps.description).toBe('keep me')
		expect(descriptionOf(withComponent)).toBe('/custom#X')
		expect(
			(descriptionOf(localized) as { clientProps: { description: unknown } }).clientProps
				.description
		).toEqual({ de: 'behalte mich', en: 'keep me' })
		expect(result.injectedFieldCount).toBe(2)
	})

	/**
	 * The function cannot go into client props, so the field takes the server
	 * variant, which evaluates it against the request's i18n instead.
	 */
	it('routes a function description to the server component and drops it from client props', () => {
		const withFunction: Field = {
			name: 'c',
			type: 'text',
			admin: { description: () => 'dynamic' },
		}
		const config = makeConfig([{ slug: 'posts', fields: [withFunction] }])
		const result = walkAndInjectFieldHelp(config, resolved)
		const injected = descriptionOf(withFunction) as {
			clientProps: Record<string, unknown>
			path: string
		}
		expect(injected.path).toBe('@10x-media/admin-wiki/rsc#WikiFieldDescriptionServer')
		expect(injected.clientProps).toEqual({ schemaPath: 'collection:posts.c' })
		expect(result.validTargetKeys).toContain('field:collection:posts.c')
		expect(result.injectedFieldCount).toBe(1)
	})
})
