import { describe, expect, it } from 'vitest'

import { isEmpty, normalize, readPath, sameValue, unionValues, writePath } from './compare'

const text = { list: false, type: 'text' } as const
const relation = { list: false, type: 'relationship' } as const
const relations = { list: true, type: 'relationship' } as const
const rows = { list: true, type: 'array' } as const
const date = { list: false, type: 'date' } as const
const checkbox = { list: false, type: 'checkbox' } as const

describe('isEmpty', () => {
	it('treats null, undefined, empty string and empty list as empty', () => {
		expect(isEmpty(null)).toBe(true)
		expect(isEmpty(undefined)).toBe(true)
		expect(isEmpty('')).toBe(true)
		expect(isEmpty([])).toBe(true)
	})

	it('keeps false and zero as values', () => {
		expect(isEmpty(false)).toBe(false)
		expect(isEmpty(0)).toBe(false)
	})
})

describe('sameValue', () => {
	it('ignores surrounding whitespace on text', () => {
		expect(sameValue(' Ivan ', 'Ivan', text)).toBe(true)
	})

	it('compares relationships by id whatever shape they arrive in', () => {
		expect(sameValue('abc', { id: 'abc', name: 'x' }, relation)).toBe(true)
		expect(sameValue(12, '12', relation)).toBe(true)
		expect(
			sameValue({ relationTo: 'a', value: '1' }, { relationTo: 'a', value: { id: '1' } }, relation)
		).toBe(true)
		expect(
			sameValue({ relationTo: 'a', value: '1' }, { relationTo: 'b', value: '1' }, relation)
		).toBe(false)
	})

	it('compares dates by instant', () => {
		expect(sameValue('2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00Z', date)).toBe(true)
		expect(sameValue('2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z', date)).toBe(false)
	})

	it('compares hasMany lists as sets', () => {
		expect(sameValue(['a', 'b'], ['b', 'a'], relations)).toBe(true)
		expect(sameValue(['a', 'b'], ['a'], relations)).toBe(false)
	})

	it('compares a group by what it holds, without the ids of the rows inside', () => {
		const group = { list: false, type: 'group' } as const
		expect(
			sameValue(
				{ title: 'Hi', links: [{ id: '1', url: 'a' }] },
				{ title: 'Hi', links: [{ id: '2', url: 'a' }] },
				group
			)
		).toBe(true)
		expect(sameValue({ title: 'Hi' }, { title: 'Ho' }, group)).toBe(false)
	})

	it('compares rows without their generated ids, in order', () => {
		expect(sameValue([{ id: '1', city: 'Kyiv' }], [{ id: '2', city: 'Kyiv' }], rows)).toBe(true)
		expect(
			sameValue(
				[{ id: '1', city: 'Kyiv' }, { city: 'Lviv' }],
				[{ id: '2', city: 'Lviv' }, { city: 'Kyiv' }],
				rows
			)
		).toBe(false)
	})

	it('keeps an `id` that is data, inside a JSON value of a row', () => {
		const rows = { list: true, type: 'array' as const }
		expect(
			sameValue([{ id: 'r1', meta: { id: 'a' } }], [{ id: 'r2', meta: { id: 'b' } }], rows)
		).toBe(false)
	})

	it('tells false from undefined on a checkbox', () => {
		expect(sameValue(false, undefined, checkbox)).toBe(false)
		expect(normalize(false, checkbox)).toBe('false')
	})
})

describe('unionValues', () => {
	it('keeps survivor members first and adds new absorbed members', () => {
		expect(unionValues(['a', 'b'], ['b', 'c'], { list: true, type: 'text' })).toEqual([
			'a',
			'b',
			'c',
		])
	})

	it('deduplicates relationships across shapes', () => {
		expect(unionValues([{ id: '1' }], ['1', '2'], relations)).toEqual([{ id: '1' }, '2'])
	})

	it('keeps every row with its id, a repeated one too', () => {
		expect(
			unionValues(
				[{ id: 'x', city: 'Kyiv' }],
				[
					{ id: 'y', city: 'Kyiv' },
					{ id: 'z', city: 'Lviv' },
				],
				rows
			)
		).toEqual([
			{ id: 'x', city: 'Kyiv' },
			{ id: 'y', city: 'Kyiv' },
			{ id: 'z', city: 'Lviv' },
		])
	})

	it('treats a scalar as a one-member list', () => {
		expect(unionValues(undefined, 'a', { list: true, type: 'text' })).toEqual(['a'])
	})
})

describe('readPath and writePath', () => {
	it('reads and writes dotted paths, creating containers on the way', () => {
		const doc: Record<string, unknown> = { profile: { bio: 'x' } }
		expect(readPath(doc, 'profile.bio')).toBe('x')
		expect(readPath(doc, 'profile.missing.deep')).toBeUndefined()
		writePath(doc, 'profile.score', 3)
		writePath(doc, 'meta.tags', ['a'])
		expect(doc).toEqual({ profile: { bio: 'x', score: 3 }, meta: { tags: ['a'] } })
	})
})

describe('isEmpty and rich text', () => {
	const lexical = (children: unknown[]) => ({
		root: { type: 'root', children, direction: null, format: '', indent: 0, version: 1 },
	})

	it('counts a rich text the editor emptied as empty, as Payload validates it', () => {
		expect(isEmpty(lexical([]))).toBe(true)
		expect(isEmpty(lexical([{ type: 'paragraph', children: [] }]))).toBe(true)
		expect(isEmpty(lexical([{ type: 'paragraph', children: [{ type: 'text', text: '' }] }]))).toBe(
			true
		)
	})

	it('counts one with text, or more than one paragraph, as a value', () => {
		expect(
			isEmpty(lexical([{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }]))
		).toBe(false)
		expect(isEmpty(lexical([{ type: 'heading', children: [] }]))).toBe(false)
	})
})
