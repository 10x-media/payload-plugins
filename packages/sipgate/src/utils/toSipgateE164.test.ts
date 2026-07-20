import { describe, expect, it } from 'vitest'
import { toSipgateE164 } from './toSipgateE164'

describe('toSipgateE164', () => {
	it('formats German national numbers to E.164 digits', () => {
		expect(toSipgateE164('01743420925')).toBe('491743420925')
	})

	it('strips a leading plus', () => {
		expect(toSipgateE164('+4915112345678')).toBe('4915112345678')
	})

	it('accepts already digit-only E.164', () => {
		expect(toSipgateE164('492111234567')).toBe('492111234567')
	})

	it('returns undefined for device IDs', () => {
		expect(toSipgateE164('e4')).toBeUndefined()
	})

	it('returns undefined for empty input', () => {
		expect(toSipgateE164('')).toBeUndefined()
		expect(toSipgateE164(null)).toBeUndefined()
		expect(toSipgateE164(undefined)).toBeUndefined()
	})
})
