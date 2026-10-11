import { describe, expect, it } from 'vitest'

import { mergeSlashGroups, mergeToolbarGroups, pickToolbar } from './model'
import type { ComposerFeature, ComposerToolbarItem } from './types'

const item = (key: string, order?: number): ComposerToolbarItem => ({ key, order })
const keysOf = (groups: { items: { key: string }[]; key: string }[]) =>
	groups.map((group) => `${group.key}[${group.items.map((entry) => entry.key).join(',')}]`)

describe('composer toolbar model', () => {
	it('merges same-key groups across features and sorts by order', () => {
		const features: ComposerFeature[] = [
			{
				key: 'a',
				toolbar: {
					groups: [
						{
							items: [item('italic', 20), item('bold', 10)],
							key: 'format',
							order: 10,
							type: 'buttons',
						},
						{ items: [item('link')], key: 'insert', order: 20, type: 'buttons' },
					],
				},
			},
			{
				key: 'color',
				toolbar: {
					groups: [
						{ items: [item('strike', 30)], key: 'format', type: 'buttons' },
						{ items: [item('red')], key: 'color', order: 15, type: 'dropdown' },
					],
				},
			},
		]
		expect(keysOf(mergeToolbarGroups(features))).toEqual([
			'format[bold,italic,strike]',
			'color[red]',
			'insert[link]',
		])
	})

	it('lets a later feature replace an item by key', () => {
		const features: ComposerFeature[] = [
			{
				key: 'a',
				toolbar: {
					groups: [{ items: [{ key: 'bold', label: 'B' }], key: 'format', type: 'buttons' }],
				},
			},
			{
				key: 'b',
				toolbar: {
					groups: [{ items: [{ key: 'bold', label: 'Strong' }], key: 'format', type: 'buttons' }],
				},
			},
		]
		const [format] = mergeToolbarGroups(features)
		expect(format?.items).toEqual([{ key: 'bold', label: 'Strong' }])
	})

	it('picks groups and items in the order given', () => {
		const groups = mergeToolbarGroups([
			{
				key: 'a',
				toolbar: {
					groups: [
						{ items: [item('bold'), item('italic')], key: 'format', order: 1, type: 'buttons' },
						{ items: [item('red'), item('blue')], key: 'color', order: 2, type: 'dropdown' },
						{ items: [item('link'), item('mention')], key: 'insert', order: 3, type: 'buttons' },
					],
				},
			},
		])
		const picked = pickToolbar(groups, ['mention', 'bold', 'italic', 'color', 'nope'])
		expect(keysOf(picked)).toEqual([
			'insert:picked:0[mention]',
			'format:picked:1[bold,italic]',
			'color[red,blue]',
		])
		expect(picked[2]?.type).toBe('dropdown')
		expect(pickToolbar(groups, undefined)).toBe(groups)
	})

	it('merges slash groups and keeps the last label', () => {
		const groups = mergeSlashGroups([
			{
				key: 'a',
				slashMenu: {
					groups: [{ items: [{ key: 'link', onSelect: () => undefined }], key: 'insert' }],
				},
			},
			{
				key: 'b',
				slashMenu: {
					groups: [
						{
							items: [{ key: 'mention', onSelect: () => undefined }],
							key: 'insert',
							label: 'Insert',
						},
					],
				},
			},
		])
		expect(groups).toHaveLength(1)
		expect(groups[0]?.label).toBe('Insert')
		expect(groups[0]?.items.map((entry) => entry.key)).toEqual(['link', 'mention'])
	})
})
