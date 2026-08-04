import { describe, expect, it } from 'vitest'
import { presetsFromArray } from './presetsFromArray'

const doc = {
	brand: {
		palette: [
			{ key: 'primary', label: 'Primary', value: '#0ea5e9', valueDark: '#0369a1' },
			{ key: 'ink', label: '', value: '#0f172a', valueDark: '#f8fafc' },
			{ key: '', label: 'No key', value: '#ffffff', valueDark: '#000000' },
			{ key: 42, label: 'Bad key', value: '#ffffff', valueDark: '#000000' },
			{ key: 'noValue', label: 'No value' },
			{ key: 'halfPair', label: 'Half', value: '#22c55e' },
			{ key: 'referenced', label: 'Ref', value: 'preset:other', valueDark: 'preset:other' },
			{ key: 'primary', label: 'Duplicate', value: '#ff0000', valueDark: '#990000' },
		],
	},
}

describe('presetsFromArray', () => {
	it('lifts flat values from rows', () => {
		expect(
			presetsFromArray({ doc, key: 'key', label: 'label', path: 'brand.palette', value: 'value' })
		).toEqual([
			{ key: 'primary', label: 'Primary', value: '#0ea5e9' },
			{ key: 'ink', label: 'ink', value: '#0f172a' },
			{ key: 'halfPair', label: 'Half', value: '#22c55e' },
		])
	})

	it('lifts scheme values from a pair of row fields', () => {
		expect(
			presetsFromArray({
				doc,
				key: 'key',
				label: 'label',
				path: 'brand.palette',
				value: { dark: 'valueDark', light: 'value' },
			})
		).toEqual([
			{ key: 'primary', label: 'Primary', value: { dark: '#0369a1', light: '#0ea5e9' } },
			{ key: 'ink', label: 'ink', value: { dark: '#f8fafc', light: '#0f172a' } },
			{ key: 'halfPair', label: 'Half', value: { dark: '#22c55e', light: '#22c55e' } },
		])
	})

	it('falls back to the raw key when no label field is configured', () => {
		const [first] = presetsFromArray({ doc, key: 'key', path: 'brand.palette', value: 'value' })
		expect(first).toEqual({ key: 'primary', label: 'primary', value: '#0ea5e9' })
	})

	it('prefixes keys without prefixing the label fallback', () => {
		const [, second] = presetsFromArray({
			doc,
			key: 'key',
			keyPrefix: 'acme/',
			label: 'label',
			path: 'brand.palette',
			value: 'value',
		})
		expect(second).toEqual({ key: 'acme/ink', label: 'ink', value: '#0f172a' })
	})

	it('returns nothing for a missing path or a non-array at the path', () => {
		expect(presetsFromArray({ doc, key: 'key', path: 'brand.missing', value: 'value' })).toEqual([])
		expect(presetsFromArray({ doc, key: 'key', path: 'brand', value: 'value' })).toEqual([])
		expect(
			presetsFromArray({ doc: {}, key: 'key', path: 'brand.palette', value: 'value' })
		).toEqual([])
	})

	it('skips rows that are not objects', () => {
		expect(
			presetsFromArray({
				doc: { palette: ['#ffffff', null, ['#000000'], { key: 'ok', value: '#0ea5e9' }] },
				key: 'key',
				path: 'palette',
				value: 'value',
			})
		).toEqual([{ key: 'ok', label: 'ok', value: '#0ea5e9' }])
	})
})
