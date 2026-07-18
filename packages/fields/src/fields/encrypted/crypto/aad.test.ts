import { describe, expect, it } from 'vitest'
import { buildAad, InvalidAadComponentError } from './aad'

describe('buildAad', () => {
	it('joins dot-free components into an unambiguous AAD', () => {
		expect(buildAad(['people', 'ssn'])).toBe('people.ssn')
		expect(buildAad(['people', 'ssn', 'de'])).toBe('people.ssn.de')
	})

	it('rejects any component containing the dot separator (L2)', () => {
		// Without per-component validation ['a.b','c'] and ['a','b.c'] both join to
		// 'a.b.c', silently conflating collection/field/locale boundaries. Forbidding
		// a dotted component removes the ambiguity at construction time.
		expect(() => buildAad(['a.b', 'c'])).toThrow(InvalidAadComponentError)
		expect(() => buildAad(['a', 'b.c'])).toThrow(InvalidAadComponentError)
		expect(() => buildAad(['people', 'ssn', 'de.at'])).toThrow(InvalidAadComponentError)
	})
})
