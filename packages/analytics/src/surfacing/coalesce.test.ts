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

	it('says whether a key is still in flight', async () => {
		const coalesce = createCoalescer<number>()
		let finish: (value: number) => void = () => {}
		const pending = coalesce('k', () => new Promise<number>((resolve) => (finish = resolve)))
		expect(coalesce.has('k')).toBe(true)
		expect(coalesce.has('other')).toBe(false)
		finish(1)
		await pending
		expect(coalesce.has('k')).toBe(false)
	})

	it('runs again after the first settles', async () => {
		const worker = vi.fn(async () => 1)
		const coalesce = createCoalescer<number>()
		await coalesce('k', worker)
		await coalesce('k', worker)
		expect(worker).toHaveBeenCalledTimes(2)
	})
})
