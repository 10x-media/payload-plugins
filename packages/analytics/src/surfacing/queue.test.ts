import { describe, expect, it, vi } from 'vitest'
import { createQueue } from './queue'

describe('createQueue', () => {
	it('never exceeds the concurrency limit', async () => {
		let active = 0
		let peak = 0
		const q = createQueue({ concurrency: 2 })
		const task = async () => {
			active++
			peak = Math.max(peak, active)
			await new Promise((r) => setTimeout(r, 5))
			active--
			return true
		}
		await Promise.all(Array.from({ length: 6 }, () => q.run(task)))
		expect(peak).toBeLessThanOrEqual(2)
	})

	it('retries on failure then succeeds, honoring maxRetries', async () => {
		const fn = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce('ok')
		const q = createQueue({ concurrency: 1, maxRetries: 2, baseDelayMs: 0 })
		await expect(q.run(fn)).resolves.toBe('ok')
		expect(fn).toHaveBeenCalledTimes(2)
	})

	it('gives up after maxRetries', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('boom'))
		const q = createQueue({ concurrency: 1, maxRetries: 1, baseDelayMs: 0 })
		await expect(q.run(fn)).rejects.toThrow('boom')
		expect(fn).toHaveBeenCalledTimes(2) // initial + 1 retry
	})
})
