import { describe, expect, it } from 'vitest'
import { fieldNames, fieldNamesOfType } from './fieldNamesOfType'

describe('fieldNamesOfType', () => {
	it('returns trimmed names of matching block types only', () => {
		const fields = [
			{ blockType: 'email', name: ' primary ' },
			{ blockType: 'text', name: 'name' },
			{ blockType: 'email', name: 'backup' },
		]
		expect(fieldNamesOfType(fields, ['email'])).toEqual(['primary', 'backup'])
	})

	it('supports multiple allowed types', () => {
		const fields = [
			{ blockType: 'email', name: 'a' },
			{ blockType: 'text', name: 'b' },
			{ blockType: 'number', name: 'c' },
		]
		expect(fieldNamesOfType(fields, ['email', 'text'])).toEqual(['a', 'b'])
	})

	it('drops rows with empty, whitespace-only, or non-string names', () => {
		const fields = [
			{ blockType: 'email', name: '' },
			{ blockType: 'email', name: '   ' },
			{ blockType: 'email', name: 42 },
			{ blockType: 'email' },
			{ blockType: 'email', name: 'ok' },
		]
		expect(fieldNamesOfType(fields, ['email'])).toEqual(['ok'])
	})

	it('tolerates non-array input and garbled rows', () => {
		expect(fieldNamesOfType(undefined, ['email'])).toEqual([])
		expect(fieldNamesOfType('not-an-array', ['email'])).toEqual([])
		expect(fieldNamesOfType([null, 'garbage', 7, { name: 'x' }], ['email'])).toEqual([])
	})
})

describe('fieldNames', () => {
	it('returns all named fields regardless of block type', () => {
		const fields = [
			{ blockType: 'email', name: 'a' },
			{ blockType: 'text', name: 'b' },
			{ blockType: 'number', name: 'c' },
		]
		expect(fieldNames(fields)).toEqual(['a', 'b', 'c'])
	})

	it('trims names and drops nameless (bare) or non-string rows', () => {
		const fields = [
			{ blockType: 'text', name: ' a ' },
			{ blockType: 'message' },
			{ blockType: 'text', name: '' },
			{ blockType: 'text', name: 7 },
		]
		expect(fieldNames(fields)).toEqual(['a'])
	})

	it('tolerates non-array input', () => {
		expect(fieldNames(undefined)).toEqual([])
		expect(fieldNames('not-an-array')).toEqual([])
	})
})
