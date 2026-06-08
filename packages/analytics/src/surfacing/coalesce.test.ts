import { describe, expect, it, vi } from 'vitest'
import { createCoalescer } from './coalesce'

describe('createCoalescer', () => {
	it('runs the worker once for concurrent identical keys', async () => {
		const worker = vi.fn(async () => 42)
		const coalesce = createCoalescer<number>()
		const [a, b] = await Promise.all([coalesce('k', worker), coalesce('k', worker)])
		expect(a).toBe(42)
		expect(b).toBe(42)
		expect(worker).toHaveBeenCalledTimes(1)
	})

	it('runs again after the first settles', async () => {
		const worker = vi.fn(async () => 1)
		const coalesce = createCoalescer<number>()
		await coalesce('k', worker)
		await coalesce('k', worker)
		expect(worker).toHaveBeenCalledTimes(2)
	})
})
