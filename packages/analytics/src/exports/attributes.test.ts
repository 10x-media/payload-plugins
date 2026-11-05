import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	eventAttributes,
	goalAttributes,
	ITEM_ATTRIBUTE,
	ITEM_CLICK_EVENT,
	ITEM_NAME_ATTRIBUTE,
	itemAttributes,
	itemRef,
	MAX_ITEM_REF_LENGTH,
	MAX_ITEMS_PER_BEACON,
	PURCHASE_GOAL_SLUG,
} from './attributes'

describe('goalAttributes', () => {
	it('spreads to nothing for an unset goal', () => {
		expect(goalAttributes(null)).toEqual({})
		expect(goalAttributes('')).toEqual({})
		expect(goalAttributes('   ')).toEqual({})
		expect(goalAttributes(undefined)).toEqual({})
	})

	it('accepts the stored string and the populated shape, like goalSlug', () => {
		expect(goalAttributes(' book-demo ')).toEqual({ 'data-analytics-goal': 'book-demo' })
		expect(goalAttributes({ slug: 'book-demo' })).toEqual({ 'data-analytics-goal': 'book-demo' })
	})

	it('carries a per-link value and currency', () => {
		expect(goalAttributes('purchase', { value: 49, currency: 'EUR' })).toEqual({
			'data-analytics-goal': 'purchase',
			'data-analytics-value': '49',
			'data-analytics-currency': 'EUR',
		})
	})

	it('leaves out a value that is not a finite number', () => {
		expect(goalAttributes('purchase', { value: Number.NaN })).toEqual({
			'data-analytics-goal': 'purchase',
		})
	})
})

describe('eventAttributes', () => {
	it('spreads to nothing without a name', () => {
		expect(eventAttributes('')).toEqual({})
		expect(eventAttributes(undefined)).toEqual({})
	})

	it('carries scalar props under the prop prefix', () => {
		expect(eventAttributes('cta_click', { plan: 'pro', seats: 3, trial: true })).toEqual({
			'data-analytics-event': 'cta_click',
			'data-analytics-prop-plan': 'pro',
			'data-analytics-prop-seats': '3',
			'data-analytics-prop-trial': 'true',
		})
	})

	it('drops non-scalars and caps the count at the ingest limit', () => {
		const props: Record<string, unknown> = { nested: { a: 1 } }
		for (let i = 0; i < 25; i++) {
			props[`k${i}`] = i
		}
		const out = eventAttributes('e', props)
		expect(out['data-analytics-prop-nested']).toBeUndefined()
		expect(Object.keys(out).length).toBe(21)
	})
})

describe('itemRef', () => {
	it('writes a document as its collection and its encoded id', () => {
		expect(itemRef('offers', 42)).toBe('offers:42')
		expect(itemRef('offers', 'a/b c')).toBe('offers:a%2Fb%20c')
	})

	it('has no ref without an id, and none longer than ingest keeps', () => {
		expect(itemRef('offers', undefined)).toBeUndefined()
		expect(itemRef('offers', null)).toBeUndefined()
		expect(itemRef('offers', '')).toBeUndefined()
		expect(itemRef('', 1)).toBeUndefined()
		expect(itemRef('offers', 'x'.repeat(MAX_ITEM_REF_LENGTH))).toBeUndefined()
	})
})

describe('itemAttributes', () => {
	it('marks an element as an item, with its name for the vendor slots', () => {
		expect(itemAttributes({ collection: 'offers', id: 7, name: ' Spring sale ' })).toEqual({
			[ITEM_ATTRIBUTE]: 'offers:7',
			[ITEM_NAME_ATTRIBUTE]: 'Spring sale',
		})
	})

	it('leaves the name out when none is given', () => {
		expect(itemAttributes({ collection: 'offers', id: 7 })).toEqual({
			'data-analytics-item': 'offers:7',
		})
		expect(itemAttributes({ collection: 'offers', id: 7, name: '  ' })).toEqual({
			'data-analytics-item': 'offers:7',
		})
	})

	it('spreads to nothing for an item without an id', () => {
		expect(itemAttributes({ collection: 'offers', id: undefined, name: 'Draft' })).toEqual({})
	})

	it('marks an element with a ref the server signed, as it was written', () => {
		expect(itemAttributes({ ref: ' offers:7@AbCdEf-_1234 ', name: 'Spring sale' })).toEqual({
			[ITEM_ATTRIBUTE]: 'offers:7@AbCdEf-_1234',
			[ITEM_NAME_ATTRIBUTE]: 'Spring sale',
		})
	})

	it('spreads to nothing for a missing ref, or one that could never be kept', () => {
		expect(itemAttributes({ ref: undefined })).toEqual({})
		expect(itemAttributes({ ref: null })).toEqual({})
		expect(itemAttributes({ ref: '  ' })).toEqual({})
		expect(itemAttributes({ ref: 'offers' })).toEqual({})
		expect(itemAttributes({ ref: ':7' })).toEqual({})
		expect(
			itemAttributes({ ref: `offers:${'x'.repeat(MAX_ITEM_REF_LENGTH)}@AbCdEf-_1234` })
		).toEqual({})
	})
})

describe('the entry itself', () => {
	it('exports the default revenue goal slug', () => {
		expect(PURCHASE_GOAL_SLUG).toBe('purchase')
	})

	it('exports the item names a host or a test can match on', () => {
		expect(ITEM_CLICK_EVENT).toBe('item_click')
		expect(MAX_ITEMS_PER_BEACON).toBe(50)
	})

	// A Lexical converter or a shared UI package imports this entry, which only works while it
	// pulls in neither Payload nor React: the constants module is its one dependency.
	it('imports nothing but the constants module, which imports nothing', () => {
		const entry = readFileSync(new URL('./attributes.ts', import.meta.url), 'utf8')
		const specifiers = [...entry.matchAll(/from '([^']+)'/g)].map((match) => match[1])
		expect(new Set(specifiers)).toEqual(new Set(['../goals/constants']))
		const constants = readFileSync(new URL('../goals/constants.ts', import.meta.url), 'utf8')
		expect(constants).not.toMatch(/^import /m)
	})
})
