import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { validateRegexFlags, validateRegexPattern } from './validateRegexParams'

const req = { t: (key: string) => key } as unknown as PayloadRequest

const PATTERN_ERROR = 'formBuilder:validation.regexPattern'
const FLAGS_ERROR = 'formBuilder:validation.regexFlags'

describe('validateRegexPattern', () => {
	it('passes a compilable pattern', () => {
		expect(validateRegexPattern('^[A-Z0-9]+$', { req })).toBe(true)
	})

	it('fails an uncompilable pattern, the case the rule itself fails open on', () => {
		expect(validateRegexPattern('(', { req })).toBe(PATTERN_ERROR)
		expect(validateRegexPattern('[a-', { req })).toBe(PATTERN_ERROR)
		expect(validateRegexPattern('a{2,1}', { req })).toBe(PATTERN_ERROR)
	})

	it('passes when the pattern is unset, leaving presence to the required flag', () => {
		expect(validateRegexPattern('', { req })).toBe(true)
		expect(validateRegexPattern(undefined, { req })).toBe(true)
	})

	it('compiles against the sibling flags, which decide validity', () => {
		expect(validateRegexPattern('\\p{L}+', { req, siblingData: { flags: 'u' } })).toBe(true)
		expect(validateRegexPattern('\\p{Nonsense}', { req, siblingData: { flags: 'u' } })).toBe(
			PATTERN_ERROR
		)
		expect(validateRegexPattern('\\p{Nonsense}', { req, siblingData: {} })).toBe(true)
	})

	it('ignores invalid sibling flags so a flag typo reports only on the flags field', () => {
		expect(validateRegexPattern('^ok$', { req, siblingData: { flags: 'zz' } })).toBe(true)
		expect(validateRegexPattern('(', { req, siblingData: { flags: 'zz' } })).toBe(PATTERN_ERROR)
	})

	it('tolerates sibling data without usable flags', () => {
		expect(validateRegexPattern('^ok$', { req, siblingData: undefined })).toBe(true)
		expect(validateRegexPattern('^ok$', { req, siblingData: { flags: '' } })).toBe(true)
		expect(validateRegexPattern('^ok$', { req, siblingData: { flags: 42 } })).toBe(true)
	})
})

describe('validateRegexFlags', () => {
	it('passes a valid flag set', () => {
		expect(validateRegexFlags('i', { req })).toBe(true)
		expect(validateRegexFlags('gim', { req })).toBe(true)
	})

	it('fails an unknown or repeated flag', () => {
		expect(validateRegexFlags('q', { req })).toBe(FLAGS_ERROR)
		expect(validateRegexFlags('ii', { req })).toBe(FLAGS_ERROR)
	})

	it('fails a mutually exclusive flag pair', () => {
		expect(validateRegexFlags('uv', { req })).toBe(FLAGS_ERROR)
	})

	it('passes when the flags are unset', () => {
		expect(validateRegexFlags('', { req })).toBe(true)
		expect(validateRegexFlags(undefined, { req })).toBe(true)
	})
})
