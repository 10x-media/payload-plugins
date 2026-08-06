import type { ClientBlock, ClientField, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { undoRedoCustom } from './fieldConfig'
import {
	buildFieldSchemaMap,
	collectIgnorePatterns,
	type WalkableBlock,
	type WalkableField,
} from './fieldSchema'

/**
 * The walk is typed structurally so it accepts Payload's own field types
 * without a cast. These assignments are the assertion: if Payload ever changes
 * the shape the walk relies on, this file stops compiling instead of the walk
 * silently missing fields at runtime.
 */
const _acceptsClientFields = (fields: ClientField[]): WalkableField[] => fields
const _acceptsServerFields = (fields: Field[]): WalkableField[] => fields
const _acceptsClientBlocks = (blocks: Record<string, ClientBlock>): Record<string, WalkableBlock> =>
	blocks

const patterns = (fields: WalkableField[], blocksMap?: Record<string, WalkableBlock>): string[] =>
	[...buildFieldSchemaMap(fields, { blocksMap }).keys()].sort()

const typeAt = (fields: WalkableField[], pattern: string): string | undefined =>
	buildFieldSchemaMap(fields).get(pattern)?.type

describe('buildFieldSchemaMap paths', () => {
	it('records top level fields by name', () => {
		expect(patterns([{ name: 'title', type: 'text' }])).toEqual(['title'])
	})

	it('adds a segment for a named group and nests', () => {
		const fields: WalkableField[] = [
			{
				name: 'named',
				type: 'group',
				fields: [
					{ name: 'alpha', type: 'text' },
					{ name: 'deep', type: 'group', fields: [{ name: 'value', type: 'text' }] },
				],
			},
		]
		expect(patterns(fields)).toEqual(['named', 'named.alpha', 'named.deep', 'named.deep.value'])
	})

	it('adds no segment for unnamed groups, rows and collapsibles', () => {
		const fields: WalkableField[] = [
			{ type: 'group', fields: [{ name: 'looseAlpha', type: 'text' }] },
			{ type: 'row', fields: [{ name: 'rowLeft', type: 'text' }] },
			{ type: 'collapsible', fields: [{ name: 'inside', type: 'text' }] },
		]
		expect(patterns(fields)).toEqual(['inside', 'looseAlpha', 'rowLeft'])
	})

	it('adds a segment for a named tab but not an unnamed one', () => {
		const fields: WalkableField[] = [
			{
				type: 'tabs',
				tabs: [
					{ fields: [{ name: 'inUnnamedTab', type: 'text' }] },
					{ name: 'seo', fields: [{ name: 'title', type: 'text' }] },
				],
			},
		]
		expect(patterns(fields)).toEqual(['inUnnamedTab', 'seo.title'])
	})

	it('collapses array rows to a wildcard segment', () => {
		const fields: WalkableField[] = [
			{
				name: 'list',
				type: 'array',
				fields: [
					{ name: 'title', type: 'text' },
					{ name: 'nested', type: 'array', fields: [{ name: 'value', type: 'text' }] },
				],
			},
		]
		expect(patterns(fields)).toEqual([
			'list',
			'list.*.nested',
			'list.*.nested.*.value',
			'list.*.title',
		])
	})

	it('walks blocks declared inline, under a row wildcard', () => {
		const fields: WalkableField[] = [
			{
				name: 'layout',
				type: 'blocks',
				blocks: [
					{ slug: 'hero', fields: [{ name: 'heading', type: 'text' }] },
					{
						slug: 'cards',
						fields: [{ name: 'cards', type: 'array', fields: [{ name: 'title', type: 'text' }] }],
					},
				],
			},
		]
		expect(patterns(fields)).toEqual([
			'layout',
			'layout.*.cards',
			'layout.*.cards.*.title',
			'layout.*.heading',
		])
	})

	it('skips ui fields, which never reach form state', () => {
		expect(
			patterns([
				{ name: 'banner', type: 'ui' },
				{ name: 'title', type: 'text' },
			])
		).toEqual(['title'])
	})
})

describe('buildFieldSchemaMap block references', () => {
	const blocksMap: Record<string, WalkableBlock> = {
		hero: { slug: 'hero', fields: [{ name: 'heading', type: 'text' }] },
	}

	it('resolves slug references through the blocks map', () => {
		const fields: WalkableField[] = [{ name: 'layout', type: 'blocks', blockReferences: ['hero'] }]
		expect(patterns(fields, blocksMap)).toEqual(['layout', 'layout.*.heading'])
	})

	it('skips references it cannot resolve instead of throwing', () => {
		const fields: WalkableField[] = [
			{ name: 'layout', type: 'blocks', blockReferences: ['hero'] },
			{ name: 'title', type: 'text' },
		]
		expect(patterns(fields)).toEqual(['layout', 'title'])
	})

	it('prefers blockReferences over blocks when both are present', () => {
		const fields: WalkableField[] = [
			{
				name: 'layout',
				type: 'blocks',
				blockReferences: ['hero'],
				blocks: [{ slug: 'other', fields: [{ name: 'ignored', type: 'text' }] }],
			},
		]
		expect(patterns(fields, blocksMap)).toEqual(['layout', 'layout.*.heading'])
	})

	it('terminates on a block that references itself', () => {
		const selfReferencing: Record<string, WalkableBlock> = {
			section: {
				slug: 'section',
				fields: [
					{ name: 'label', type: 'text' },
					{ name: 'inner', type: 'blocks', blockReferences: ['section'] },
				],
			},
		}
		const fields: WalkableField[] = [
			{ name: 'sections', type: 'blocks', blockReferences: ['section'] },
		]
		expect(patterns(fields, selfReferencing)).toEqual([
			'sections',
			'sections.*.inner',
			'sections.*.label',
		])
	})
})

describe('buildFieldSchemaMap types', () => {
	it('records the field type', () => {
		const fields: WalkableField[] = [
			{ name: 'content', type: 'richText' },
			{ name: 'list', type: 'array', fields: [{ name: 'rowRich', type: 'richText' }] },
		]
		expect(typeAt(fields, 'content')).toBe('richText')
		expect(typeAt(fields, 'list.*.rowRich')).toBe('richText')
		expect(typeAt(fields, 'list')).toBe('array')
	})

	it('reports an ambiguous type when two blocks disagree at one position', () => {
		const fields: WalkableField[] = [
			{
				name: 'layout',
				type: 'blocks',
				blocks: [
					{ slug: 'rich', fields: [{ name: 'body', type: 'richText' }] },
					{ slug: 'plain', fields: [{ name: 'body', type: 'text' }] },
				],
			},
		]
		const entry = buildFieldSchemaMap(fields).get('layout.*.body')
		expect(entry?.type).toBeUndefined()
		expect(entry?.types.sort()).toEqual(['richText', 'text'])
	})

	it('keeps the type when two blocks agree at one position', () => {
		const fields: WalkableField[] = [
			{
				name: 'layout',
				type: 'blocks',
				blocks: [
					{ slug: 'a', fields: [{ name: 'body', type: 'richText' }] },
					{ slug: 'b', fields: [{ name: 'body', type: 'richText' }] },
				],
			},
		]
		expect(typeAt(fields, 'layout.*.body')).toBe('richText')
	})
})

describe('collectIgnorePatterns', () => {
	const disabled = { custom: undoRedoCustom({ disabled: true }) }

	it('collects fields opted out through admin.custom', () => {
		const fields: WalkableField[] = [
			{ name: 'title', type: 'text' },
			{ name: 'content', type: 'richText', admin: disabled },
		]
		expect(collectIgnorePatterns(buildFieldSchemaMap(fields))).toEqual(['content'])
	})

	it('collects an opted out field inside array rows', () => {
		const fields: WalkableField[] = [
			{
				name: 'list',
				type: 'array',
				fields: [
					{ name: 'title', type: 'text' },
					{ name: 'rowRich', type: 'richText', admin: disabled },
				],
			},
		]
		expect(collectIgnorePatterns(buildFieldSchemaMap(fields))).toEqual(['list.*.rowRich'])
	})

	it('emits only the container for an opted out subtree', () => {
		const fields: WalkableField[] = [
			{
				name: 'named',
				type: 'group',
				admin: disabled,
				fields: [{ name: 'alpha', type: 'text' }],
			},
		]
		// Container patterns already match their subtree, so `named.alpha`
		// needs no entry of its own.
		expect(collectIgnorePatterns(buildFieldSchemaMap(fields))).toEqual(['named'])
	})

	it('collects by field type', () => {
		const fields: WalkableField[] = [
			{ name: 'title', type: 'text' },
			{ name: 'content', type: 'richText' },
			{ name: 'list', type: 'array', fields: [{ name: 'rowRich', type: 'richText' }] },
		]
		expect(collectIgnorePatterns(buildFieldSchemaMap(fields), ['richText']).sort()).toEqual([
			'content',
			'list.*.rowRich',
		])
	})

	it('opts out an ambiguous pattern when any contributor asks for it', () => {
		const fields: WalkableField[] = [
			{
				name: 'layout',
				type: 'blocks',
				blocks: [
					{ slug: 'rich', fields: [{ name: 'body', type: 'richText', admin: disabled }] },
					{ slug: 'plain', fields: [{ name: 'body', type: 'text' }] },
				],
			},
		]
		expect(collectIgnorePatterns(buildFieldSchemaMap(fields))).toEqual(['layout.*.body'])
	})

	it('returns nothing when no field opts out', () => {
		expect(collectIgnorePatterns(buildFieldSchemaMap([{ name: 'title', type: 'text' }]))).toEqual(
			[]
		)
	})
})
