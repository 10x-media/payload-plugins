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

	it('consults shouldRetry per attempt instead of maxRetries when provided', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error('one'))
			.mockRejectedValueOnce(new Error('two'))
			.mockResolvedValueOnce('ok')
		const shouldRetry = vi.fn((_err: unknown, attempt: number) => attempt < 2)
		const q = createQueue({ concurrency: 1, maxRetries: 0, baseDelayMs: 0, shouldRetry })
		await expect(q.run(fn)).resolves.toBe('ok')
		expect(fn).toHaveBeenCalledTimes(3)
		expect(shouldRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 0)
		expect(shouldRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 1)
	})

	it('stops retrying once shouldRetry returns false', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('fatal'))
		const shouldRetry = vi.fn(() => false)
		const q = createQueue({ concurrency: 1, maxRetries: 5, baseDelayMs: 0, shouldRetry })
		await expect(q.run(fn)).rejects.toThrow('fatal')
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it('rethrows the original task error when the signal aborts mid-backoff', async () => {
		vi.useFakeTimers()
		try {
			const taskErr = new Error('task failed')
			const fn = vi.fn().mockRejectedValue(taskErr)
			const q = createQueue({ concurrency: 1, maxRetries: 3, baseDelayMs: 1000 })
			const controller = new AbortController()

			const promise = q.run(fn, controller.signal)
			const assertion = expect(promise).rejects.toBe(taskErr)

			await vi.advanceTimersByTimeAsync(0) // let the first attempt reject
			controller.abort(new Error('aborted for unrelated reason'))
			await vi.advanceTimersByTimeAsync(1000)

			await assertion
			expect(fn).toHaveBeenCalledTimes(1)
		} finally {
			vi.useRealTimers()
		}
	})

	it('refuses to start when already aborted, throwing the abort reason', async () => {
		const fn = vi.fn()
		const q = createQueue({ concurrency: 1 })
		const controller = new AbortController()
		const reason = new Error('already aborted')
		controller.abort(reason)

		await expect(q.run(fn, controller.signal)).rejects.toBe(reason)
		expect(fn).not.toHaveBeenCalled()
	})

	it('rethrows the task error immediately, without sleeping, when the signal aborted before backoff started', async () => {
		vi.useFakeTimers()
		try {
			const taskErr = new Error('task failed')
			const controller = new AbortController()
			// Aborts during the attempt itself, so by the time withRetry reaches wait()
			// the 'abort' event has already fired and a fresh listener would never see it.
			const fn = vi.fn().mockImplementation(async () => {
				controller.abort(new Error('aborted mid-attempt'))
				throw taskErr
			})
			const q = createQueue({ concurrency: 1, maxRetries: 3, baseDelayMs: 1000 })

			await expect(q.run(fn, controller.signal)).rejects.toBe(taskErr)
			expect(fn).toHaveBeenCalledTimes(1)
		} finally {
			vi.useRealTimers()
		}
	})
})
