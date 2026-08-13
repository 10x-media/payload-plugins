import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { LexicalRichTextAdapter } from '@payloadcms/richtext-lexical'
import { createServerFeature } from '@payloadcms/richtext-lexical'
import type { Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { adminWiki } from '../../src/index'

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

const guideEditorFeatureKeys = (booted: BootedPayload): string[] => {
	const pages = booted.payload.config.collections.find(
		(collection) => collection.slug === 'wiki-pages'
	)
	const content = pages ? findField(pages.fields, 'content') : undefined
	const editor = (content as undefined | { editor?: LexicalRichTextAdapter })?.editor
	return (editor?.features ?? []).map((feature) => feature.key)
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
