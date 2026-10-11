import { describe, expect, it } from 'vitest'
import {
	canonicalJson,
	hasMethods,
	isOneOf,
	isRecord,
	kindOf,
	listOf,
	valueAt,
	wholeNumberParam,
} from './values'

describe('hasMethods', () => {
	it('passes an object or a function carrying every named method', () => {
		const model = Object.assign(() => null, { find: () => [], updateOne: () => ({}) })
		expect(hasMethods({ query: () => null, connect: () => null }, ['query', 'connect'])).toBe(true)
		expect(hasMethods(model, ['find', 'updateOne'])).toBe(true)
	})

	it('refuses a missing method, a non-function property and anything that is no object', () => {
		expect(hasMethods({ query: () => null }, ['query', 'connect'])).toBe(false)
		expect(hasMethods({ query: 'select' }, ['query'])).toBe(false)
		for (const value of [null, undefined, 'query', 1]) {
			expect(hasMethods(value, ['query']), String(value)).toBe(false)
		}
	})
})

describe('isOneOf', () => {
	it('passes a member of the list by identity, and nothing else', () => {
		const modes = ['fixed', 'none'] as const
		expect(isOneOf(modes, 'fixed')).toBe(true)
		expect(isOneOf(modes, 'trust')).toBe(false)
		expect(isOneOf(modes, undefined)).toBe(false)
		expect(isOneOf([1, 2], '1')).toBe(false)
	})
})

describe('isRecord', () => {
	it('passes objects and arrays, and nothing else', () => {
		expect(isRecord({})).toBe(true)
		expect(isRecord([])).toBe(true)
		for (const value of [null, undefined, 'x', 1, true, () => null]) {
			expect(isRecord(value), String(value)).toBe(false)
		}
	})
})

describe('kindOf', () => {
	it('quotes a string, names an array, and types the rest', () => {
		expect(kindOf('all')).toBe('"all"')
		expect(kindOf(['a'])).toBe('an array')
		expect(kindOf(1)).toBe('number')
		expect(kindOf(null)).toBe('object')
		expect(kindOf(undefined)).toBe('undefined')
	})
})

describe('listOf', () => {
	it('lists names as a boot error says them', () => {
		expect(listOf([])).toBe('')
		expect(listOf(['queue'])).toBe('queue')
		expect(listOf(['slug', 'overrides'])).toBe('slug and overrides')
		expect(listOf(['queue', 'tasks', 'state'])).toBe('queue, tasks and state')
	})
})

describe('valueAt', () => {
	it('reads a dotted path, and stops at the first step that is not an object', () => {
		const doc = { posthog: { host: 'https://eu.posthog.com' }, provider: 'posthog', list: ['a'] }
		expect(valueAt(doc, 'posthog.host')).toBe('https://eu.posthog.com')
		expect(valueAt(doc, 'provider')).toBe('posthog')
		expect(valueAt(doc, 'list.0')).toBe('a')
		expect(valueAt(doc, 'provider.length')).toBeUndefined()
		expect(valueAt(doc, 'umami.host')).toBeUndefined()
		expect(valueAt(null, 'a')).toBeUndefined()
	})
})

describe('canonicalJson', () => {
	it('writes the same text whatever order the keys were set in', () => {
		expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
			canonicalJson({ a: { c: 3, d: 2 }, b: 1 })
		)
		expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
	})

	it('drops undefined keys, writes Dates as ISO and keeps array order', () => {
		const at = new Date('2026-01-02T03:04:05.000Z')
		expect(canonicalJson({ a: undefined, at, xs: [2, 1] })).toBe(
			'{"at":"2026-01-02T03:04:05.000Z","xs":[2,1]}'
		)
		expect(canonicalJson([undefined, 1])).toBe('[null,1]')
	})

	it('tells a string from an array holding it, and null from a missing key', () => {
		expect(canonicalJson({ a: 'x' })).not.toBe(canonicalJson({ a: ['x'] }))
		expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}))
	})
})

describe('wholeNumberParam', () => {
	// `Number(null)` is 0: a missing `limit` would otherwise clamp to one row.
	it('reads an absent or blank parameter as no value, never as zero', () => {
		expect(wholeNumberParam(null)).toBeUndefined()
		expect(wholeNumberParam(undefined)).toBeUndefined()
		expect(wholeNumberParam('')).toBeUndefined()
		expect(wholeNumberParam('  ')).toBeUndefined()
	})

	it('reads whole numbers and refuses anything else', () => {
		expect(wholeNumberParam('5')).toBe(5)
		expect(wholeNumberParam(' 25 ')).toBe(25)
		expect(wholeNumberParam('-3')).toBe(-3)
		expect(wholeNumberParam('2.5')).toBeUndefined()
		expect(wholeNumberParam('1e3')).toBeUndefined()
		expect(wholeNumberParam('abc')).toBeUndefined()
		expect(wholeNumberParam('99999999999999999999')).toBeUndefined()
	})
})
