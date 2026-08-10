import type { ClientBlock, ClientField } from 'payload'
import { describe, expect, it } from 'vitest'

import { collectClientBlocks, resolveClientLabel } from './clientBlocks'

const block = (slug: string, fields: ClientField[] = []): ClientBlock =>
	({ slug, fields }) as unknown as ClientBlock

const collect = (fields: ClientField[], blocksMap: Record<string, ClientBlock> = {}): string[] => {
	const found = new Map<string, ClientBlock>()
	collectClientBlocks(fields, found, blocksMap)
	return [...found.keys()]
}

describe('collectClientBlocks', () => {
	it('finds inline blocks through every container field', () => {
		const fields = [
			{
				name: 'meta',
				type: 'group',
				fields: [
					{
						type: 'tabs',
						tabs: [
							{
								label: 'Layout',
								fields: [
									{
										type: 'row',
										fields: [{ name: 'layout', type: 'blocks', blocks: [block('hero')] }],
									},
								],
							},
						],
					},
				],
			},
		] as unknown as ClientField[]
		expect(collect(fields)).toEqual(['hero'])
	})

	it('resolves block references through the config blocks map', () => {
		const fields = [
			{ name: 'layout', type: 'blocks', blockReferences: ['shared'] },
		] as unknown as ClientField[]
		expect(collect(fields, { shared: block('shared') })).toEqual(['shared'])
		expect(collect(fields)).toEqual([])
	})

	it('descends into a block nested inside another block', () => {
		const fields = [
			{
				name: 'layout',
				type: 'blocks',
				blocks: [
					block('outer', [
						{ name: 'inner', type: 'blocks', blocks: [block('nested')] },
					] as unknown as ClientField[]),
				],
			},
		] as unknown as ClientField[]
		expect(collect(fields)).toEqual(['outer', 'nested'])
	})
})

describe('resolveClientLabel', () => {
	it('passes a plain string through', () => {
		expect(resolveClientLabel('Hero', 'en', 'hero')).toBe('Hero')
	})

	it('picks the language, then its base, then the first declared value', () => {
		expect(resolveClientLabel({ de: 'Held', en: 'Hero' }, 'de', 'hero')).toBe('Held')
		expect(resolveClientLabel({ de: 'Held', en: 'Hero' }, 'de-DE', 'hero')).toBe('Held')
		expect(resolveClientLabel({ fr: 'Héros' }, 'en', 'hero')).toBe('Héros')
	})

	it('falls back for a missing or unusable label', () => {
		expect(resolveClientLabel(undefined, 'en', 'hero')).toBe('hero')
		expect(resolveClientLabel(null, 'en', 'hero')).toBe('hero')
		expect(resolveClientLabel({}, 'en', 'hero')).toBe('hero')
	})
})
