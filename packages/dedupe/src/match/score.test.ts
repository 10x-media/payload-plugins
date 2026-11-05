import { describe, expect, it } from 'vitest'

import { blockingKeys, pairKeyFor } from './keys'
import { presets } from './presets'
import { differPenalty, fieldValues, type ResolvedMatchField, scorePair } from './score'

const fields: ResolvedMatchField[] = [
	{ path: 'email', weight: 45, compare: presets.exact },
	{ path: 'name', weight: 40, compare: presets.text },
	{ path: 'phone', weight: 35, compare: presets.phone },
	{ path: 'birthDate', weight: 25, compare: presets.date },
]

const ivan = {
	email: 'ivan@mail.com',
	name: 'Ivan Petrenko',
	phone: '+380 50 123 45 67',
	birthDate: '1998-04-12',
}

describe('scorePair', () => {
	it('scores an identical pair as 1 with a match signal per field', () => {
		const result = scorePair(ivan, { ...ivan }, fields)
		expect(result.score).toBe(1)
		expect(result.signals.map((signal) => signal.kind)).toEqual([
			'match',
			'match',
			'match',
			'match',
		])
	})

	it('scores a record with a different email and a late typo high, with signals to explain, none for an empty field', () => {
		const result = scorePair(
			ivan,
			{ email: 'i.petrenko@mail.com', name: 'Petrenko Ivan', phone: '0501234567' },
			fields
		)
		expect(result.score).toBeGreaterThan(0.35)
		expect(result.signals).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: 'email', kind: 'differ' }),
				expect.objectContaining({ path: 'name', kind: 'match' }),
				expect.objectContaining({ path: 'phone', kind: 'match' }),
			])
		)
		expect(result.signals.map((signal) => signal.path)).not.toContain('birthDate')
	})

	it('drops a pair that only shares a birth date', () => {
		const result = scorePair(
			ivan,
			{ email: 'olga@mail.com', name: 'Olga Koval', birthDate: '1998-04-12' },
			fields
		)
		expect(result.score).toBeLessThan(0.35)
	})

	it('zeroes a pair on a veto field', () => {
		const withVeto: ResolvedMatchField[] = [
			...fields,
			{ path: 'taxId', weight: 50, compare: presets.exact, onDiffer: 'veto' },
		]
		const result = scorePair({ ...ivan, taxId: '1' }, { ...ivan, taxId: '2' }, withVeto)
		expect(result.score).toBe(0)
		expect(result.signals.find((signal) => signal.path === 'taxId')?.kind).toBe('veto')
	})

	it('compares every locale of a localized value', () => {
		const result = scorePair(
			{ name: { en: 'Ivan Petrenko', uk: 'Іван Петренко' } },
			{ name: { en: 'Petrenko Ivan' } },
			[fields[1] as ResolvedMatchField]
		)
		expect(result.score).toBe(1)
	})
})

describe('blockingKeys', () => {
	it('prefixes every key with its field path and skips fields with key: false', () => {
		const keys = blockingKeys(ivan, [
			...fields.slice(0, 2),
			{ path: 'phone', weight: 35, compare: presets.phone, key: false },
		])
		expect(keys).toEqual(
			expect.arrayContaining([
				'email=ivan@mail.com',
				'name=ivan|petrenko',
				'name=~petr',
				'name=~ivan',
			])
		)
		expect(keys.some((key) => key.startsWith('phone='))).toBe(false)
	})

	it('prefixes every key with the tenant so tenants never share a bucket', () => {
		const keys = blockingKeys(ivan, fields.slice(0, 1), 'acme')
		expect(keys).toEqual(['t:acme|email=ivan@mail.com'])
	})
})

describe('pairKeyFor', () => {
	it('is the same whichever way round', () => {
		expect(pairKeyFor('leads', 'b', 'a')).toBe('leads:a:b')
		expect(pairKeyFor('leads', 2, 10)).toBe('leads:10:2')
		expect(pairKeyFor('leads', 1, 2)).not.toBe(pairKeyFor('customers', 1, 2))
	})
})

describe('weights', () => {
	it('keeps a small or fractional weight whole: a quarter of it against, its share for a near match', () => {
		expect(differPenalty({ path: 'a', weight: 1 })).toBe(-0.25)
		const near = scorePair({ name: 'Ivan Petrenko' }, { name: 'Ivan Petrenkoo' }, [
			{ path: 'name', weight: 0.5, compare: presets.text },
		])
		expect(near.signals[0]?.kind).toBe('similar')
		expect(near.score).toBeGreaterThanOrEqual(0.85)
	})

	it('scores a birth date entered day first as similar, not as a difference', () => {
		const result = scorePair({ birthDate: '1998-04-12' }, { birthDate: '1998-12-04' }, [
			{ path: 'birthDate', weight: 25, compare: presets.date, onDiffer: 'veto' },
		])
		expect(result.signals[0]?.kind).toBe('similar')
	})
})

describe('fieldValues', () => {
	it('reads every locale of a localized field, the Indonesian `id` one too', () => {
		expect(fieldValues({ name: { en: 'Anna', id: 'Ana' } }, 'name', true).sort()).toEqual([
			'Ana',
			'Anna',
		])
	})
})

describe('blockingKeys', () => {
	it('keeps a key from a long text short enough for a database index', () => {
		const keys = blockingKeys({ bio: 'word '.repeat(2000) }, [
			{ path: 'bio', weight: 1, compare: presets.exact },
		])
		expect(keys.every((key) => key.length <= 200)).toBe(true)
		expect(keys).toEqual(
			blockingKeys({ bio: 'word '.repeat(2000) }, [
				{ path: 'bio', weight: 1, compare: presets.exact },
			])
		)
	})
})
