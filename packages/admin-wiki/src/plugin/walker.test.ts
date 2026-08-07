import type { CollectionConfig, Config, Field, GlobalConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { resolveOptions } from './resolveOptions'
import { walkAndInjectFieldHelp } from './walker'

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
		expect(result.validTargetKeys).toContain('field:posts.title')
		expect(result.validTargetKeys).toContain('field:posts.plain')
		expect(result.validTargetKeys).toContain('field:posts.meta.seoTitle')
		expect(result.validTargetKeys).toContain('field:posts.hero')
		expect(result.validTargetKeys).toContain('field:posts.hero.headline')
		const injected = descriptionOf(titleField) as { clientProps: { schemaPath: string } }
		expect(injected.clientProps.schemaPath).toBe('posts.title')
		expect(result.injectedFieldCount).toBe(5)
	})

	it('collects block slugs, walks block fields, and injects block labels', () => {
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
		expect(result.validTargetKeys).toContain('field:pages.layout.cta.label')
		const injectedLabel = (ctaBlock as { admin?: { components?: { Label?: unknown } } }).admin
			?.components?.Label
		expect(injectedLabel).toMatchObject({ clientProps: { blockSlug: 'cta' } })
		expect(labeledBlock.admin.components.Label).toBe('/custom#Label')
	})

	it('walks globals and skips the wiki collections', () => {
		const config = makeConfig(
			[{ slug: 'wiki-pages', fields: [{ name: 'title', type: 'text' }] }],
			[{ slug: 'settings', fields: [{ name: 'siteName', type: 'text' }] }]
		)
		const result = walkAndInjectFieldHelp(config, resolved)
		expect(result.validTargetKeys).toContain('global:settings')
		expect(result.validTargetKeys).toContain('field:settings.siteName')
		expect(result.validTargetKeys).not.toContain('collection:wiki-pages')
		expect(result.validTargetKeys).not.toContain('field:wiki-pages.title')
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
		const withFunction: Field = {
			name: 'c',
			type: 'text',
			admin: { description: () => 'dynamic' },
		}
		const config = makeConfig([
			{ slug: 'posts', fields: [withStatic, withComponent, withFunction] },
		])
		const result = walkAndInjectFieldHelp(config, resolved)
		const injected = descriptionOf(withStatic) as { clientProps: { description: unknown } }
		expect(injected.clientProps.description).toBe('keep me')
		expect(descriptionOf(withComponent)).toBe('/custom#X')
		expect(descriptionOf(withFunction)).toBeUndefined()
		expect(result.validTargetKeys).toContain('field:posts.c')
		expect(result.injectedFieldCount).toBe(1)
	})
})
