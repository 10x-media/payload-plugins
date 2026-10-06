import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { LexicalRichTextAdapter } from '@payloadcms/richtext-lexical'
import { createServerFeature } from '@payloadcms/richtext-lexical'
import type { Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { adminWiki, getWikiRegistry } from '../../src/index'

/**
 * A consumer feature reaching the guide editor. Asserted after a real boot
 * rather than off `buildWikiEditor`, because what matters is that the feature
 * survives Payload's own sanitization of the field it was handed to, which is
 * where a badly shaped one would be rejected.
 */
const ConsumerFeature = createServerFeature({
	feature: () => ({}),
	key: 'consumerTestFeature',
})

/** Depth-first search for a named field, through the tabs the wiki form is built from. */
const findField = (fields: Field[], name: string): Field | undefined => {
	for (const field of fields) {
		if ('name' in field && field.name === name) {
			return field
		}
		if (field.type === 'tabs') {
			for (const tab of field.tabs) {
				const found = findField(tab.fields, name)
				if (found) {
					return found
				}
			}
			continue
		}
		if ('fields' in field) {
			const found = findField(field.fields, name)
			if (found) {
				return found
			}
		}
	}
	return undefined
}

const guideEditor = (booted: BootedPayload): LexicalRichTextAdapter | undefined => {
	const pages = booted.payload.config.collections.find(
		(collection) => collection.slug === 'wiki-pages'
	)
	const content = pages ? findField(pages.fields, 'content') : undefined
	return (content as undefined | { editor?: LexicalRichTextAdapter })?.editor
}

const guideEditorFeatureKeys = (booted: BootedPayload): string[] =>
	(guideEditor(booted)?.features ?? []).map((feature) => feature.key)

/**
 * The blocks feature keeps both lists in its sanitized server props, which is
 * where a block ends up once Payload has sanitized the fields it declares.
 */
const guideEditorBlockSlugs = (
	booted: BootedPayload
): { blocks: string[]; inlineBlocks: string[] } => {
	const feature = guideEditor(booted)?.editorConfig?.resolvedFeatureMap?.get('blocks') as
		| undefined
		| {
				sanitizedServerFeatureProps?: {
					blocks?: { slug: string }[]
					inlineBlocks?: { slug: string }[]
				}
		  }
	const props = feature?.sanitizedServerFeatureProps
	return {
		blocks: (props?.blocks ?? []).map((block) => block.slug),
		inlineBlocks: (props?.inlineBlocks ?? []).map((block) => block.slug),
	}
}

/** The editor Payload sanitized for the `body` field of the callout block. */
const calloutBodyEditor = (booted: BootedPayload): LexicalRichTextAdapter | undefined => {
	const feature = guideEditor(booted)?.editorConfig?.resolvedFeatureMap?.get('blocks') as
		| undefined
		| { sanitizedServerFeatureProps?: { blocks?: { fields: Field[]; slug: string }[] } }
	const callout = feature?.sanitizedServerFeatureProps?.blocks?.find(
		(block) => block.slug === 'wikiCallout'
	)
	const body = callout ? findField(callout.fields, 'body') : undefined
	return (body as undefined | { editor?: LexicalRichTextAdapter })?.editor
}

const calloutBodyFeatureKeys = (booted: BootedPayload): string[] =>
	(calloutBodyEditor(booted)?.features ?? []).map((feature) => feature.key)

/** The same lists for the editor inside a callout body. */
const calloutBodyBlockSlugs = (
	booted: BootedPayload
): { blocks: string[]; inlineBlocks: string[] } => {
	const nested = calloutBodyEditor(booted)?.editorConfig?.resolvedFeatureMap?.get('blocks') as
		| undefined
		| {
				sanitizedServerFeatureProps?: {
					blocks?: { slug: string }[]
					inlineBlocks?: { slug: string }[]
				}
		  }
	const props = nested?.sanitizedServerFeatureProps
	return {
		blocks: (props?.blocks ?? []).map((block) => block.slug),
		inlineBlocks: (props?.inlineBlocks ?? []).map((block) => block.slug),
	}
}

describeForDb('wiki editor features', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: adminWiki({ editor: { features: [ConsumerFeature(undefined)] } }),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers a consumer feature alongside the plugin ones', () => {
		const keys = guideEditorFeatureKeys(booted)
		expect(keys).toContain('consumerTestFeature')
		// The plugin's own list is still whole: an array of features adds, it does
		// not replace.
		expect(keys).toContain('wikiGuideLink')
		expect(keys).toContain('blocks')
	})
})

describeForDb('wiki editor features, function form', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: adminWiki({
				editor: {
					features: ({ defaultFeatures }) => [
						...defaultFeatures.filter((feature) => feature.key !== 'align'),
						ConsumerFeature(undefined),
					],
				},
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('hands the plugin features over to be reshaped', () => {
		const keys = guideEditorFeatureKeys(booted)
		expect(keys).toContain('consumerTestFeature')
		expect(keys).toContain('wikiGuideLink')
		expect(keys).not.toContain('align')
	})
})

describeForDb('wiki editor inline blocks', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: adminWiki({
				editor: {
					blocks: [
						{
							block: { slug: 'devTip', fields: [{ name: 'tip', type: 'text' }] },
							component: '/Tip#Tip',
						},
					],
					inlineBlocks: [
						{
							block: { slug: 'devChip', fields: [{ name: 'label', type: 'text' }] },
							component: '/Chip#Chip',
						},
					],
				},
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('registers inline blocks beside blocks without mixing the two lists', () => {
		const { blocks, inlineBlocks } = guideEditorBlockSlugs(booted)
		expect(inlineBlocks).toEqual(['devChip'])
		// The plugin's own callout is still a block, and a consumer block does not
		// leak into the inline list.
		expect(blocks).toContain('wikiCallout')
		expect(blocks).toContain('devTip')
		expect(blocks).not.toContain('devChip')
	})

	it('keeps both renderers reachable through the registry', () => {
		const registry = getWikiRegistry(booted.payload.config)
		expect(registry?.editorBlocks.map((option) => option.component)).toEqual(['/Tip#Tip'])
		expect(registry?.editorInlineBlocks.map((option) => option.component)).toEqual(['/Chip#Chip'])
	})
})

describeForDb('callout body editor', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: adminWiki({
				editor: {
					blocks: [
						{
							block: { slug: 'devTip', fields: [{ name: 'tip', type: 'text' }] },
							component: '/Tip#Tip',
							nestable: true,
						},
						{
							block: { slug: 'devHero', fields: [{ name: 'title', type: 'text' }] },
							component: '/Hero#Hero',
						},
					],
					inlineBlocks: [
						{
							block: { slug: 'devChip', fields: [{ name: 'label', type: 'text' }] },
							component: '/Chip#Chip',
						},
						{
							block: { slug: 'devWide', fields: [{ name: 'label', type: 'text' }] },
							component: '/Wide#Wide',
							nestable: false,
						},
					],
				},
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('takes the nestable blocks and never the callout itself', () => {
		const { blocks } = calloutBodyBlockSlugs(booted)
		expect(blocks).toContain('devTip')
		expect(blocks).not.toContain('devHero')
		expect(blocks).not.toContain('wikiCallout')
	})

	it('keeps inline blocks unless they opt out', () => {
		const { inlineBlocks } = calloutBodyBlockSlugs(booted)
		expect(inlineBlocks).toEqual(['devChip'])
	})

	it('leaves headings out of the body', () => {
		expect(guideEditorFeatureKeys(booted)).toContain('heading')
		expect(calloutBodyFeatureKeys(booted)).not.toContain('heading')
	})

	it('keeps the content a note holds and drops the document furniture', () => {
		const keys = calloutBodyFeatureKeys(booted)
		expect(keys).toContain('strikethrough')
		expect(keys).toContain('align')
		expect(keys).toContain('unorderedList')
		expect(keys).toContain('orderedList')
		expect(keys).toContain('upload')
		expect(keys).not.toContain('blockquote')
		expect(keys).not.toContain('horizontalRule')
		expect(keys).not.toContain('indent')
		expect(keys).not.toContain('toolbarFixed')
	})
})

describeForDb('callout body editor with nothing to nest', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: adminWiki({
				editor: {
					features: ({ defaultFeatures, nested }) =>
						nested ? [...defaultFeatures, ConsumerFeature(undefined)] : defaultFeatures,
				},
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('hands the features function the flag telling the two editors apart', () => {
		expect(calloutBodyFeatureKeys(booted)).toContain('consumerTestFeature')
		expect(guideEditorFeatureKeys(booted)).not.toContain('consumerTestFeature')
	})

	it('registers no blocks feature at all, so the toolbar offers no empty insert', () => {
		expect(guideEditorFeatureKeys(booted)).toContain('blocks')
		expect(calloutBodyFeatureKeys(booted)).not.toContain('blocks')
	})
})
