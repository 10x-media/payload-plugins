import { describe, expect, it } from 'vitest'
import {
	bareItemRef,
	boundItemRef,
	isItemClick,
	itemDocumentId,
	itemRefOf,
	parseItemRef,
	parseItemValue,
} from './ref'

describe('parseItemValue', () => {
	const signature = 'AbCdEf-_1234'

	it('reads a signed value as its ref and its signature', () => {
		expect(parseItemValue(`offers:42@${signature}`)).toEqual({ ref: 'offers:42', signature })
		expect(parseItemValue(`offers:a%40b@${signature}`)).toEqual({
			ref: 'offers:a%40b',
			signature,
		})
	})

	it('reads an unsigned value as a ref alone', () => {
		expect(parseItemValue('offers:42')).toEqual({ ref: 'offers:42' })
	})

	it('refuses a signature of the wrong shape, or a ref that is not well formed', () => {
		for (const value of [
			undefined,
			42,
			'offers:42@',
			`offers:42@${signature}x`,
			`offers:42@${signature.slice(1)}`,
			'offers:42@!!!!!!!!!!!!',
			`offers@${signature}`,
			`offers:a@b@${signature}`,
		]) {
			expect(parseItemValue(value)).toBeNull()
		}
	})
})

describe('bareItemRef', () => {
	it('drops the signature a vendor has no use for', () => {
		expect(bareItemRef('offers:42@AbCdEf-_1234')).toBe('offers:42')
		expect(bareItemRef('offers:42')).toBe('offers:42')
	})
})

describe('parseItemRef', () => {
	it('splits a ref into its collection and its encoded id', () => {
		expect(parseItemRef('offers:42')).toEqual({ collection: 'offers', id: '42' })
		expect(parseItemRef('offers:a%3Ab')).toEqual({ collection: 'offers', id: 'a%3Ab' })
	})

	it('refuses anything that is not one well-formed ref', () => {
		for (const value of [
			undefined,
			42,
			'',
			'offers',
			':42',
			'offers:',
			'offers:a b',
			'offers:%E0%A4%A',
			`offers:${'x'.repeat(130)}`,
		]) {
			expect(parseItemRef(value)).toBeNull()
		}
	})

	it('keeps one spelling per document: an id must be written as encodeURIComponent writes it', () => {
		expect(parseItemRef('offers:%61')).toBeNull()
		expect(parseItemRef('offers:a')).not.toBeNull()
	})

	it('decodes the id back to what the collection stores', () => {
		const parts = parseItemRef('offers:a%3Ab%2Fc')
		expect(parts && itemDocumentId(parts)).toBe('a:b/c')
	})
})

describe('boundItemRef', () => {
	const bound = new Set(['offers'])

	it('keeps a ref whose collection is bound as items', () => {
		expect(boundItemRef('offers:42', bound)).toBe('offers:42')
	})

	it('drops a ref of any other collection, and anything malformed', () => {
		expect(boundItemRef('pages:42', bound)).toBeUndefined()
		expect(boundItemRef('offers', bound)).toBeUndefined()
		expect(boundItemRef(['offers:42'], bound)).toBeUndefined()
	})

	// A database that casts ids fails a whole lookup on one it cannot cast.
	it('drops a ref whose id cannot be one of its collection ids', () => {
		const idTypes = new Map([['offers', 'objectId' as const]])
		expect(boundItemRef('offers:x', bound, idTypes)).toBeUndefined()
		expect(boundItemRef('offers:65f0c0ffee0123456789abcd', bound, idTypes)).toBe(
			'offers:65f0c0ffee0123456789abcd'
		)
		expect(
			boundItemRef('offers:x', bound, new Map([['offers', 'serial' as const]]))
		).toBeUndefined()
		expect(boundItemRef('offers:12', bound, new Map([['offers', 'serial' as const]]))).toBe(
			'offers:12'
		)
	})

	it('checks a decoded id, and keeps any id of a collection whose id type it was not told', () => {
		expect(boundItemRef('offers:a%3Ab', bound, new Map([['offers', 'text' as const]]))).toBe(
			'offers:a%3Ab'
		)
		expect(boundItemRef('offers:x', bound, new Map())).toBe('offers:x')
	})
})

describe('itemRefOf', () => {
	it('writes a document id as a ref', () => {
		expect(itemRefOf('offers', 42)).toBe('offers:42')
		expect(itemRefOf('offers', 'a:b')).toBe('offers:a%3Ab')
	})

	it('has no ref for a document without an id, or one too long to keep', () => {
		expect(itemRefOf('offers', undefined)).toBeUndefined()
		expect(itemRefOf('offers', '')).toBeUndefined()
		expect(itemRefOf('offers', { id: 1 })).toBeUndefined()
		expect(itemRefOf('offers', 'x'.repeat(130))).toBeUndefined()
	})
})

describe('isItemClick', () => {
	it('is an item_click event carrying an item', () => {
		expect(isItemClick({ type: 'event', name: 'item_click', item: 'offers:1' })).toBe(true)
	})

	it('is nothing else: another event, a goal, or a click with no item', () => {
		expect(isItemClick({ type: 'event', name: 'signup', item: 'offers:1' })).toBe(false)
		expect(isItemClick({ type: 'goal', name: 'item_click', item: 'offers:1' })).toBe(false)
		expect(isItemClick({ type: 'event', name: 'item_click' })).toBe(false)
		expect(isItemClick({ type: 'event', name: 'item_click', item: null })).toBe(false)
	})
})
