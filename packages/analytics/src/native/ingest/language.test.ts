import { describe, expect, it } from 'vitest'
import { MAX_LANGUAGE_LENGTH, primaryLanguage } from './language'

describe('primaryLanguage', () => {
	it('takes the first tag of an Accept-Language header, lowercased', () => {
		expect(primaryLanguage('de-DE,de;q=0.9,en-US;q=0.8')).toBe('de-de')
	})

	it('drops the quality factor from a single weighted tag', () => {
		expect(primaryLanguage('en-GB;q=0.7')).toBe('en-gb')
	})

	it('trims surrounding whitespace', () => {
		expect(primaryLanguage('  fr-CA , fr;q=0.8')).toBe('fr-ca')
	})

	it('reports nothing for the wildcard, an empty header, or none at all', () => {
		expect(primaryLanguage('*')).toBeUndefined()
		expect(primaryLanguage('')).toBeUndefined()
		expect(primaryLanguage('   ')).toBeUndefined()
		expect(primaryLanguage(null)).toBeUndefined()
	})

	it('caps an absurdly long tag', () => {
		expect(primaryLanguage(`${'x'.repeat(60)},en`)).toHaveLength(MAX_LANGUAGE_LENGTH)
	})
})
