import { describe, expect, it } from 'vitest'

import { chosenUploadIds, ID_SEPARATOR } from './chosenUploadIds'

const MEDIA = 'media'

describe('chosenUploadIds', () => {
	it('has nothing to report for an empty field', () => {
		expect(chosenUploadIds(undefined, MEDIA)).toEqual([])
		expect(chosenUploadIds(null, MEDIA)).toEqual([])
		expect(chosenUploadIds([], MEDIA)).toEqual([])
	})

	it('counts a single value the same as an array of one', () => {
		// A field without `hasMany` stores a bare id, and Payload's list tab hides it too.
		expect(chosenUploadIds('abc', MEDIA)).toEqual(['abc'])
		expect(chosenUploadIds(7, MEDIA)).toEqual(['7'])
	})

	it('reads a list of plain ids', () => {
		expect(chosenUploadIds(['a', 'b'], MEDIA)).toEqual(['a', 'b'])
		expect(chosenUploadIds([1, 2], MEDIA)).toEqual(['1', '2'])
	})

	describe('polymorphic pairs', () => {
		it('keeps only the collection being browsed', () => {
			const value = [
				{ relationTo: 'media', value: 'a' },
				{ relationTo: 'files', value: 'b' },
			]

			expect(chosenUploadIds(value, MEDIA)).toEqual(['a'])
			expect(chosenUploadIds(value, 'files')).toEqual(['b'])
		})

		it('does not collide on ids shared across collections', () => {
			const value = [
				{ relationTo: 'media', value: 1 },
				{ relationTo: 'files', value: 1 },
			]

			expect(chosenUploadIds(value, MEDIA)).toEqual(['1'])
		})
	})

	describe('populated documents', () => {
		it('reads the id', () => {
			expect(chosenUploadIds([{ filename: 'logo.svg', id: 'abc' }], MEDIA)).toEqual(['abc'])
		})

		it('reads the id even when the document has a field named value', () => {
			// The ambiguous case: checked as a polymorphic pair first, this would store the
			// contents of the collection's own `value` field instead of the id.
			expect(chosenUploadIds([{ id: 'abc', value: 'not an id' }], MEDIA)).toEqual(['abc'])
		})
	})

	it('reads the non-polymorphic object form', () => {
		expect(chosenUploadIds([{ value: 'abc' }], MEDIA)).toEqual(['abc'])
	})

	it('reads a mixture of shapes', () => {
		const value = ['a', { relationTo: 'media', value: 'b' }, { id: 'c' }, { value: 'd' }]

		expect(chosenUploadIds(value, MEDIA)).toEqual(['a', 'b', 'c', 'd'])
	})

	it('drops entries it cannot read an id from', () => {
		expect(chosenUploadIds([null, undefined, {}, ''], MEDIA)).toEqual([])
	})

	it('survives a round trip through the separator', () => {
		// Payload allows custom text ids, where a comma is a legal character.
		const ids = chosenUploadIds(['a,b', 'c'], MEDIA)

		expect(ids.join(ID_SEPARATOR).split(ID_SEPARATOR)).toEqual(['a,b', 'c'])
	})
})
