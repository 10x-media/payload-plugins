import { describe, expect, it } from 'vitest'

import { SIMILAR_THRESHOLD } from './score'
import { jaroWinkler, tokenSimilarity } from './similarity'

describe('jaroWinkler', () => {
	it('scores identical strings as 1 and unrelated strings low', () => {
		expect(jaroWinkler('petrenko', 'petrenko')).toBe(1)
		expect(jaroWinkler('petrenko', 'koval')).toBeLessThan(0.6)
	})

	it('scores a late typo as similar', () => {
		expect(jaroWinkler('petrenko', 'petrenok')).toBeGreaterThan(0.9)
	})

	it('handles empty input', () => {
		expect(jaroWinkler('', 'a')).toBe(0)
	})
})

describe('tokenSimilarity', () => {
	it('ignores token order', () => {
		expect(tokenSimilarity(['ivan', 'petrenko'], ['petrenko', 'ivan'])).toBe(1)
	})

	it('counts a middle name present on one side as similar, not as a mismatch', () => {
		const score = tokenSimilarity(['ivan', 'petrenko'], ['ivan', 'olehovych', 'petrenko'])
		expect(score).toBeGreaterThanOrEqual(SIMILAR_THRESHOLD)
		expect(score).toBeLessThan(1)
	})

	it('returns 0 for an empty side', () => {
		expect(tokenSimilarity([], ['a'])).toBe(0)
	})
})
