import { describe, expect, it } from 'vitest'

import { dateKey, dateParts, digits, foldText, normalizeText, scalarsOf } from './normalize'

describe('normalizeText', () => {
	it('folds accents, case and punctuation', () => {
		expect(normalizeText('  Zalká, Csaba ')).toBe('zalka csaba')
		expect(normalizeText('Þórsdóttir')).toBe('thorsdottir')
		expect(normalizeText('Müller-Lüdenscheidt')).toBe('muller ludenscheidt')
	})

	it('keeps non-Latin letters', () => {
		expect(normalizeText('Іван Петренко')).toBe('іван петренко')
	})

	it('keeps the combining marks other scripts spell with, rather than splitting words on them', () => {
		// Devanagari vowel signs and a Japanese voiced mark after decomposition.
		expect(normalizeText('राजेश कुमार')).toBe('राजेश कुमार')
		expect(normalizeText('ガンダム')).toBe('ガンダム')
		expect(normalizeText('راجيش')).toBe('راجيش')
	})
})

describe('digits and dates', () => {
	it('keeps digits only', () => {
		expect(digits('+380 (50) 123-45-67')).toBe('380501234567')
	})

	it('parses dates in UTC and formats keys', () => {
		const parts = dateParts('1998-04-12T00:00:00.000Z')
		expect(parts).toEqual({ year: 1998, month: 4, day: 12 })
		expect(dateKey(parts as NonNullable<typeof parts>)).toBe('1998-04-12')
		expect(dateParts('not a date')).toBeNull()
		expect(dateParts({})).toBeNull()
	})
})

describe('scalarsOf', () => {
	it('flattens lists, locale maps and relationship shapes', () => {
		expect(scalarsOf({ en: 'a', de: 'b' })).toEqual(['a', 'b'])
		expect(scalarsOf(['a', ['b']])).toEqual(['a', 'b'])
		expect(scalarsOf({ id: '1', name: 'x' })).toEqual(['1'])
		expect(scalarsOf({ relationTo: 'c', value: { id: '2' } })).toEqual(['c:2'])
		expect(scalarsOf('')).toEqual([])
		expect(scalarsOf(null)).toEqual([])
	})

	it('keeps which collection a polymorphic relationship points at', () => {
		expect(scalarsOf({ relationTo: 'companies', value: '1' })).not.toEqual(
			scalarsOf({ relationTo: 'users', value: '1' })
		)
	})
})

describe('foldText beyond Latin', () => {
	it('keeps the letters Cyrillic builds with a combining mark, й, ї and ў', () => {
		expect([foldText('Йосип'), foldText('Київ'), foldText('Ўладзімір')]).toEqual([
			'йосип',
			'київ',
			'ўладзімір',
		])
		expect(foldText('Йосип')).not.toBe(foldText('Иосип'))
	})

	it('folds what is written either way: ё as е, Greek without its accents', () => {
		expect(foldText('Фёдор Королёв')).toBe(foldText('Федор Королев'))
		// ё typed as е and a combining diaeresis, as some files and PDFs keep it.
		expect(foldText('Фе\u0308дор')).toBe(foldText('Федор'))
		expect(foldText('ΕΛΕΝΗ ΠΑΠΑΔΟΠΟΥΛΟΥ')).toBe(foldText('Ελένη Παπαδοπούλου'))
	})

	it('still drops Latin accents', () => {
		expect(foldText('José Müller Ångström')).toBe('jose muller angstrom')
	})
})
