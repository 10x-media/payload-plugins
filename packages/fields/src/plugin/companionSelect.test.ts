import type { CollectionConfig, Field, PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	companionSelect,
	scanCompanions,
	withCompanionSelect,
	withCompanions,
} from './companionSelect'

const args = (select?: Record<string, unknown>) =>
	({ operation: 'find', req: {} as PayloadRequest, select }) as unknown as Parameters<
		NonNullable<CollectionConfig['select']>
	>[0]

describe('companion select', () => {
	const fields: Field[] = [
		withCompanions({ name: 'brand', type: 'text' }, ['brandResolved']),
		{
			name: 'meta',
			type: 'group',
			fields: [withCompanions({ name: 'key', type: 'text' }, ['key_set', 'key_hint'])],
		},
		{ type: 'row', fields: [withCompanions({ name: 'inRow', type: 'text' }, ['inRowResolved'])] },
	]

	it('scans names and dot paths through groups and layout containers', () => {
		expect(scanCompanions(fields)).toEqual([
			{ path: 'brand', siblings: ['brandResolved'] },
			{ path: 'meta.key', siblings: ['meta.key_set', 'meta.key_hint'] },
			{ path: 'inRow', siblings: ['inRowResolved'] },
		])
	})

	it('keeps whatever the field already carries in custom', () => {
		const field = withCompanions(
			{ custom: { '@10x-media/fields': { other: 1 }, mine: true }, name: 'a', type: 'text' },
			['aResolved']
		)
		expect(field.custom).toEqual({
			'@10x-media/fields': { other: 1, selectWith: ['aResolved'] },
			mine: true,
		})
	})

	it('adds siblings only for selected fields, nested ones included', () => {
		const select = companionSelect(scanCompanions(fields), undefined)
		expect(select(args({ brand: true }))).toEqual({ brand: true, brandResolved: true })
		expect(select(args({ meta: { key: true } }))).toEqual({
			meta: { key: true, key_hint: true, key_set: true },
		})
		expect(select(args({ meta: true }))).toBeUndefined()
		expect(select(args({ title: true }))).toBeUndefined()
	})

	it('leaves full reads and exclude-mode selects alone', () => {
		const select = companionSelect(scanCompanions(fields), undefined)
		expect(select(args())).toBeUndefined()
		expect(select(args({ brand: false }))).toBeUndefined()
	})

	it("runs after the collection's own select function", () => {
		const prior: CollectionConfig['select'] = ({ select }) =>
			select ? { ...select, brand: true } : undefined
		const select = companionSelect(scanCompanions(fields), prior)
		expect(select(args({ title: true }))).toEqual({ brand: true, brandResolved: true, title: true })
	})

	it('returns the collection untouched when nothing is marked', () => {
		const collection: CollectionConfig = { fields: [{ name: 'a', type: 'text' }], slug: 'plain' }
		expect(withCompanionSelect(collection)).toBe(collection)
	})
})
