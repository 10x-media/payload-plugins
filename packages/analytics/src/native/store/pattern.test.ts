import { describe, expect, it } from 'vitest'
import { classifyError } from '../../surfacing/classifyError'
import { checkMatchesPattern, MAX_PATTERN_LENGTH, patternFault, patternRefusal } from './pattern'

/** Patterns every store reads alike. */
const ACCEPTED_PATTERNS: readonly string[] = [
	'',
	'^/blog/',
	'\\.pdf$',
	'^/(docs|guides)/',
	'^/p/[0-9]+$',
	'^/p/\\d{2,3}$',
	'[a-z]{3}',
	'[^/]+\\.html?$',
	'(?:pricing|plans)',
	'^/über',
	'a.b',
	'[-a]',
	'[a-]',
	'[\\]x]',
	'\\w+-\\s?\\d*',
	'^$',
	'x{2}',
	'x{2,}',
	'(ab)+',
]

describe('patternRefusal', () => {
	it.each(ACCEPTED_PATTERNS)('accepts %j, which JavaScript reads as well', (pattern) => {
		expect(patternRefusal(pattern)).toBeNull()
		expect(() => new RegExp(pattern, 'i')).not.toThrow()
	})

	it.each([
		['[^]1', /first in a class/],
		['(', /never closed/],
		[')', /closes no group/],
		['a**', /right after another/],
		['a*?', /right after another/],
		['a++', /right after another/],
		['a{2,1}', /out of order/],
		['a{300}', /above 255/],
		['a{,2}', /starts no/],
		['{', /nothing to repeat/],
		['*a', /nothing to repeat/],
		['^*', /after an anchor/],
		['(a+)+', /repeated group/],
		['(a|b)*', /repeated group/],
		['a|', /empty alternative/],
		['|a', /empty alternative/],
		['()', /empty group/],
		['(?=a)', /other than/],
		['(?<n>a)', /other than/],
		['\\1', /escape/],
		['\\b', /escape/],
		['\\p{L}', /escape/],
		['\\', /trailing backslash/],
		['[[:alpha:]]', /inside a class/],
		['[\\D]', /inside a class/],
		['[z-a]', /backwards/],
		['[a-c-e]', /right after a range/],
		['[a', /never closed/],
		['a]', /unpaired/],
		['a}', /unpaired/],
		['a\nb', /control/],
	])('refuses %j', (pattern, reason) => {
		expect(patternRefusal(pattern)).toMatch(reason)
	})

	it('refuses a pattern past its length', () => {
		expect(patternRefusal('a'.repeat(MAX_PATTERN_LENGTH))).toBeNull()
		expect(patternRefusal('a'.repeat(MAX_PATTERN_LENGTH + 1))).toMatch(/at most/)
	})

	it('throws what endpoints answer 400 invalid_param, naming the filters', () => {
		const thrown = (() => {
			try {
				checkMatchesPattern('[^]1')
				return null
			} catch (err) {
				return err
			}
		})()
		expect(classifyError(thrown)).toMatchObject({ kind: 'invalid_param', param: 'filters' })
		expect(() => checkMatchesPattern('^/blog/')).not.toThrow()
	})
})

describe('patternFault', () => {
	it("answers a database's refusal of the pattern as the query's fault, keeping the driver error", () => {
		const driver = Object.assign(
			new Error('invalid regular expression: brackets [] not balanced'),
			{
				code: '2201B',
			}
		)
		const fault = patternFault(driver)
		expect(classifyError(fault)).toMatchObject({ kind: 'invalid_param', param: 'filters' })
		expect(fault instanceof Error && fault.cause).toBe(driver)
		const down = new Error('connection terminated')
		expect(patternFault(down)).toBe(down)
	})
})
