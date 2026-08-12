import type { ClientBlock, ClientConfig } from 'payload'
import { describe, expect, it } from 'vitest'

import { collectBlockUsages } from './blockUsages'

const hero: ClientBlock = {
	slug: 'hero',
	fields: [{ name: 'heading', type: 'text' }],
} as ClientBlock

const registryCta: ClientBlock = {
	slug: 'cta',
	fields: [{ name: 'label', type: 'text' }],
} as ClientBlock

const inlineCta: ClientBlock = {
	slug: 'cta',
	fields: [{ name: 'url', type: 'text' }],
} as ClientBlock

const panel: ClientBlock = {
	slug: 'panel',
	fields: [{ name: 'title', type: 'text' }],
} as ClientBlock

const accordion: ClientBlock = {
	slug: 'accordion',
	fields: [{ name: 'panels', type: 'blocks', blockReferences: ['panel'] }],
} as ClientBlock

const orphan: ClientBlock = { slug: 'orphan', fields: [] } as ClientBlock

const configOf = (collections: unknown[], globals: unknown[] = []): ClientConfig =>
	({
		blocksMap: { accordion, cta: registryCta, hero, orphan, panel },
		collections,
		globals,
	}) as unknown as ClientConfig

const covered = (collections: string[], globals: string[] = []) => ({ collections, globals })

describe('collectBlockUsages', () => {
	it('keys a block by its usage path under the owning entity', () => {
		const usages = collectBlockUsages(
			configOf([
				{
					slug: 'posts',
					fields: [{ name: 'layout', type: 'blocks', blockReferences: ['hero'] }],
				},
			]),
			covered(['posts'])
		)
		expect(usages.get('hero')).toEqual({
			block: hero,
			entityKind: 'collection',
			entitySlug: 'posts',
			schemaPath: 'posts.layout.hero',
		})
	})

	it('carries the _index- segments of unnamed tabs, and the names of named ones', () => {
		const usages = collectBlockUsages(
			configOf([
				{
					slug: 'posts',
					fields: [
						{ name: 'title', type: 'text' },
						{
							type: 'tabs',
							tabs: [
								{
									label: 'Content',
									fields: [{ name: 'layout', type: 'blocks', blockReferences: ['hero'] }],
								},
								{
									name: 'meta',
									label: 'Meta',
									fields: [{ name: 'extras', type: 'blocks', blockReferences: ['cta'] }],
								},
							],
						},
					],
				},
			]),
			covered(['posts'])
		)
		expect(usages.get('hero')?.schemaPath).toBe('posts._index-1-0.layout.hero')
		expect(usages.get('cta')?.schemaPath).toBe('posts._index-1.meta.extras.cta')
	})

	it('resets the index path under a named group and keeps it under a row', () => {
		const usages = collectBlockUsages(
			configOf([
				{
					slug: 'posts',
					fields: [
						{
							name: 'branding',
							type: 'group',
							fields: [{ name: 'layout', type: 'blocks', blockReferences: ['hero'] }],
						},
						{
							type: 'row',
							fields: [{ name: 'extras', type: 'blocks', blockReferences: ['cta'] }],
						},
					],
				},
			]),
			covered(['posts'])
		)
		expect(usages.get('hero')?.schemaPath).toBe('posts.branding.layout.hero')
		expect(usages.get('cta')?.schemaPath).toBe('posts._index-1.extras.cta')
	})

	it('descends into a block to reach the blocks it allows', () => {
		const usages = collectBlockUsages(
			configOf([
				{
					slug: 'posts',
					fields: [{ name: 'layout', type: 'blocks', blockReferences: ['accordion'] }],
				},
			]),
			covered(['posts'])
		)
		expect(usages.get('panel')?.schemaPath).toBe('posts.layout.accordion.panels.panel')
	})

	it('prefers the registry variant when a slug is also declared inline', () => {
		const config = configOf(
			[{ slug: 'posts', fields: [{ name: 'layout', type: 'blocks', blockReferences: ['cta'] }] }],
			[{ slug: 'settings', fields: [{ name: 'sections', type: 'blocks', blocks: [inlineCta] }] }]
		)
		const fromCollectionFirst = collectBlockUsages(config, covered(['posts'], ['settings']))
		expect(fromCollectionFirst.get('cta')?.block).toBe(registryCta)

		const inlineOnly = collectBlockUsages(config, covered([], ['settings']))
		expect(inlineOnly.get('cta')?.block).toBe(inlineCta)
		expect(inlineOnly.get('cta')?.schemaPath).toBe('settings.sections.cta')
	})

	it('walks globals as well as collections', () => {
		const usages = collectBlockUsages(
			configOf(
				[],
				[{ slug: 'settings', fields: [{ name: 'sections', type: 'blocks', blocks: [hero] }] }]
			),
			covered([], ['settings'])
		)
		expect(usages.get('hero')).toMatchObject({
			entityKind: 'global',
			entitySlug: 'settings',
			schemaPath: 'settings.sections.hero',
		})
	})

	it('ignores entities the plugin does not cover', () => {
		const usages = collectBlockUsages(
			configOf([
				{ slug: 'posts', fields: [{ name: 'layout', type: 'blocks', blockReferences: ['hero'] }] },
			]),
			covered([])
		)
		expect(usages.size).toBe(0)
	})

	it('has no entry for a registry block nothing renders', () => {
		const usages = collectBlockUsages(
			configOf([
				{ slug: 'posts', fields: [{ name: 'layout', type: 'blocks', blockReferences: ['hero'] }] },
			]),
			covered(['posts'])
		)
		expect(usages.has('orphan')).toBe(false)
	})
})
