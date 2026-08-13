import { describe, expect, it } from 'vitest'
import { answerValues } from './answerValues'

describe('answerValues', () => {
	it('returns empty for non-array input', () => {
		expect(answerValues(undefined, 'vote')).toEqual([])
		expect(answerValues(null, 'vote')).toEqual([])
		expect(answerValues({ field: 'vote', value: 'a' }, 'vote')).toEqual([])
	})

	it('returns empty when the field has no entry', () => {
		expect(answerValues([{ field: 'other', value: 'a' }], 'vote')).toEqual([])
	})

	it('wraps a scalar answer and spreads an array answer', () => {
		expect(answerValues([{ field: 'vote', value: 'a' }], 'vote')).toEqual(['a'])
		expect(answerValues([{ field: 'vote', value: ['a', 'b'] }], 'vote')).toEqual(['a', 'b'])
	})

	it('filters null and empty-string values', () => {
		expect(answerValues([{ field: 'vote', value: '' }], 'vote')).toEqual([])
		expect(answerValues([{ field: 'vote', value: [null, '', 'a'] }], 'vote')).toEqual(['a'])
	})

	it('coerces non-string values to strings', () => {
		expect(answerValues([{ field: 'vote', value: [1, true] }], 'vote')).toEqual(['1', 'true'])
	})
})
