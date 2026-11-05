import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTokenSource } from './rateLimiter'

const interactive = { priority: 'interactive' as const }

/** Whether a take has resolved yet, without awaiting it. */
const watch = (pending: Promise<void>): { done: boolean } => {
	const state = { done: false }
	void pending.then(() => {
		state.done = true
	})
	return state
}

describe('createTokenSource', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it('never waits without a per-minute or per-hour limit', async () => {
		const tokens = createTokenSource({ maxConcurrent: 1 })
		await Promise.all([
			tokens.take(interactive),
			tokens.take(interactive),
			tokens.take(interactive),
		])
		expect(tokens.waiting).toBe(0)
	})

	it('spends one token per take and makes the one past capacity wait for the refill', async () => {
		const tokens = createTokenSource({ requestsPerMinute: 2 })
		await tokens.take(interactive)
		await tokens.take(interactive)
		const third = watch(tokens.take(interactive))
		await vi.advanceTimersByTimeAsync(29_999)
		expect(third.done).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		expect(third.done).toBe(true)
	})

	it('needs a token from every bucket, gating on the tighter one', async () => {
		// The minute bucket refills every 12 s, the hour bucket every 30 minutes.
		const tokens = createTokenSource({ requestsPerMinute: 5, requestsPerHour: 2 })
		await tokens.take(interactive)
		await tokens.take(interactive)
		const third = watch(tokens.take(interactive))
		await vi.advanceTimersByTimeAsync(12_000)
		expect(third.done).toBe(false)
		await vi.advanceTimersByTimeAsync(1_800_000 - 12_000)
		expect(third.done).toBe(true)
	})

	it('serves a waiting reader before background work that waited longer', async () => {
		const tokens = createTokenSource({ requestsPerMinute: 1 })
		await tokens.take(interactive)
		const order: string[] = []
		void tokens.take({ priority: 'background' }).then(() => order.push('background'))
		void tokens.take(interactive).then(() => order.push('interactive'))
		await vi.advanceTimersByTimeAsync(60_000)
		expect(order).toEqual(['interactive'])
		await vi.advanceTimersByTimeAsync(60_000)
		expect(order).toEqual(['interactive', 'background'])
	})

	it('serves interactive takers, then normal ones, then background work, each in arrival order', async () => {
		const tokens = createTokenSource({ requestsPerMinute: 1 })
		await tokens.take(interactive)
		const order: string[] = []
		void tokens.take({ priority: 'background' }).then(() => order.push('background'))
		void tokens.take({ priority: 'normal' }).then(() => order.push('normal'))
		void tokens.take(interactive).then(() => order.push('interactive'))
		await vi.advanceTimersByTimeAsync(3 * 60_000)
		expect(order).toEqual(['interactive', 'normal', 'background'])
	})

	it('drops an aborted taker without spending the token it waited for', async () => {
		const tokens = createTokenSource({ requestsPerMinute: 1 })
		await tokens.take(interactive)
		const controller = new AbortController()
		const reason = new Error('aborted')
		const abandoned = tokens.take({ signal: controller.signal, priority: 'interactive' })
		const refused = expect(abandoned).rejects.toBe(reason)
		controller.abort(reason)
		await refused
		expect(tokens.waiting).toBe(0)
		const next = watch(tokens.take(interactive))
		await vi.advanceTimersByTimeAsync(59_999)
		expect(next.done).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		expect(next.done).toBe(true)
	})

	it('refuses at once when the signal already aborted', async () => {
		const tokens = createTokenSource({ requestsPerMinute: 1 })
		const controller = new AbortController()
		const reason = new Error('already aborted')
		controller.abort(reason)
		await expect(tokens.take({ signal: controller.signal, priority: 'interactive' })).rejects.toBe(
			reason
		)
	})
})
