import { afterEach, describe, expect, it, vi } from 'vitest'

import { answerCache } from './api'

describe('answerCache', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('shares an answer for a moment, then asks again: a document saved since changes it', async () => {
		vi.useFakeTimers()
		const remember = answerCache<number>(5_000)
		let asked = 0
		const ask = async () => ++asked

		expect(await remember('k', ask)).toBe(1)
		expect(await remember('k', ask)).toBe(1)
		vi.advanceTimersByTime(5_001)
		expect(await remember('k', ask)).toBe(2)
	})

	it('forgets a failed answer at once', async () => {
		const remember = answerCache<number>(5_000)
		await expect(remember('k', () => Promise.reject(new Error('down')))).rejects.toThrow('down')
		expect(await remember('k', async () => 7)).toBe(7)
	})
})
