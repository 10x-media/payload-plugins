import { describe, expect, it } from 'vitest'

import { presets, resolveCompare } from './presets'

describe('exact', () => {
	it('keys on the normalized value and matches case-insensitively', () => {
		expect(presets.exact.keys(' Ivan@Mail.com ')).toEqual(['ivan@mail.com'])
		expect(presets.exact.similarity('Ivan@Mail.com', 'ivan@mail.com')).toBe(1)
		expect(presets.exact.similarity('a', 'b')).toBe(0)
		expect(presets.exact.keys('')).toEqual([])
	})
})

describe('text', () => {
	it('emits the sorted token key, a prefix per token and the letters without spaces', () => {
		expect(presets.text.keys('Petrenko Ivan')).toEqual([
			'ivan|petrenko',
			'~petr',
			'~ivan',
			'=petrenkoivan',
		])
	})

	it('shares a prefix key across a late typo', () => {
		const a = new Set(presets.text.keys('Ivan Petrenko'))
		const b = presets.text.keys('Ivan Petrenok')
		expect(b.some((key) => a.has(key))).toBe(true)
	})

	it('scores swapped and slightly misspelled names as similar, extra words on one side included', () => {
		expect(presets.text.similarity('Ivan Petrenko', 'Petrenko Ivan')).toBe(1)
		expect(presets.text.similarity('Ivan Petrenko', 'Ivan Petrenok')).toBeGreaterThan(0.9)
		expect(presets.text.similarity('Jan van der Berg', 'Jan Berg')).toBe(1)
		expect(presets.text.similarity('Ivan Petrenko', 'Olga Koval')).toBeLessThan(0.7)
	})

	it('meets a name written as one word or two, and counts it as the same', () => {
		const apart = new Set(presets.text.keys('Er Gen'))
		expect(presets.text.keys('Ergen').some((key) => apart.has(key))).toBe(true)
		expect(presets.text.similarity('Er Gen', 'Ergen')).toBe(1)
		expect(presets.text.similarity('Van Damme', 'Vandamme')).toBe(1)
		expect(presets.text.similarity('Ergen', 'Er Gan')).toBeLessThan(1)
	})
})

describe('phone', () => {
	it('keys and compares on the last nine digits', () => {
		expect(presets.phone.keys('+380 50 123 45 67')).toEqual(['501234567'])
		expect(presets.phone.similarity('+380501234567', '0501234567')).toBe(1)
		expect(presets.phone.similarity('0501234567', '0501234568')).toBe(0)
		expect(presets.phone.keys('12')).toEqual([])
	})
})

describe('number', () => {
	const shareKey = (compare: ReturnType<typeof resolveCompare>, a: unknown, b: unknown) => {
		const left = new Set(compare.keys(a))
		return compare.keys(b).some((key) => left.has(key))
	}

	it('compares numbers exactly by default, however they are written', () => {
		const exact = resolveCompare('number')
		expect(exact.similarity(42, '42.0')).toBe(1)
		expect(exact.similarity(42, 43)).toBe(0)
		expect(exact.keys('42.0')).toEqual(exact.keys(42))
		expect(exact.keys('not a number')).toEqual([])
	})

	it('with a value tolerance counts values within that share of each other as similar', () => {
		const within = resolveCompare('number', { toleranceType: 'value', tolerance: 5 })
		expect(within.similarity(100, 100)).toBe(1)
		const close = within.similarity(100, 104)
		expect(close).toBeGreaterThanOrEqual(0.85)
		expect(close).toBeLessThan(1)
		expect(within.similarity(100, 102)).toBeGreaterThan(close)
		expect(within.similarity(100, 106)).toBe(0)
		expect(shareKey(within, 100, 104)).toBe(true)
		expect(shareKey(within, 1000, 1049)).toBe(true)
		expect(shareKey(within, 100, 300)).toBe(false)
	})

	it('with a quantity tolerance counts values with that share of characters differing as similar', () => {
		const typo = resolveCompare('number', { toleranceType: 'quantity', tolerance: 10 })
		const one = typo.similarity('1234567890', '1234567891')
		expect(one).toBeGreaterThanOrEqual(0.85)
		expect(one).toBeLessThan(1)
		expect(typo.similarity('1234567890', '1234567811')).toBe(0)
		expect(typo.similarity('1234567890', '123456789')).toBeGreaterThanOrEqual(0.85)
		expect(shareKey(typo, '1234567890', '1234567891')).toBe(true)
		expect(shareKey(typo, '1234567890', '123456789')).toBe(true)
		expect(shareKey(typo, '1234567890', '9876543210')).toBe(false)
	})
})

describe('date', () => {
	it('adds the day and month swapped form when the day could be a month', () => {
		expect(presets.date.keys('1998-04-12')).toEqual(['1998-04-12', '1998-12-04'])
		expect(presets.date.keys('1998-04-04')).toEqual(['1998-04-04'])
		expect(presets.date.keys('1998-04-20')).toEqual(['1998-04-20'])
	})

	it('scores exact, swapped and different dates', () => {
		expect(presets.date.similarity('1998-04-12', '1998-04-12T00:00:00.000Z')).toBe(1)
		// A swapped day and month is a typo, not a different date: above the similar threshold.
		expect(presets.date.similarity('1998-04-12', '1998-12-04')).toBe(0.9)
		expect(presets.date.similarity('1998-04-12', '1999-04-12')).toBe(0)
		expect(presets.date.similarity('nope', '1998-04-12')).toBe(0)
	})
})

describe('exact punctuation', () => {
	it('keeps punctuation, so two different emails never share a key', () => {
		expect(presets.exact.keys('ivan.p@mail.com')).not.toEqual(presets.exact.keys('ivan-p@mail.com'))
		expect(presets.exact.similarity('ivan@mail.com', 'ivan.mail@com')).toBe(0)
		expect(presets.exact.similarity('Ivan@Mail.com ', 'ivan@mail.com')).toBe(1)
	})
})

describe('resolveCompare', () => {
	it('defaults to exact and passes a custom comparison through', () => {
		expect(resolveCompare(undefined)).toBe(presets.exact)
		expect(Object.keys(presets).sort()).toEqual(['date', 'exact', 'number', 'phone', 'text'])
		const custom = { keys: () => ['k'], similarity: () => 1 }
		expect(resolveCompare(custom)).toBe(custom)
	})
})
