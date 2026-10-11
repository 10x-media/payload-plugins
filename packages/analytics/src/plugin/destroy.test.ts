import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { isDestroyed, onDestroy } from './destroy'

/** An instance whose own `destroy` records when it ran, as Payload's stops crons and the adapter. */
const instance = (order: string[]) => {
	const payload = {
		logger: { warn: vi.fn() },
		destroy: async () => {
			order.push('payload.destroy')
		},
	}
	return payload as unknown as Payload
}

describe('onDestroy', () => {
	it('closes what the plugin holds before Payload’s own destroy runs, and marks the instance', async () => {
		const order: string[] = []
		const payload = instance(order)
		onDestroy(payload, async () => {
			order.push('close')
		})
		expect(isDestroyed(payload)).toBe(false)
		await payload.destroy()
		expect(order).toEqual(['close', 'payload.destroy'])
		expect(isDestroyed(payload)).toBe(true)
	})

	it('wraps an instance once, and closes once however often it is destroyed', async () => {
		const order: string[] = []
		const payload = instance(order)
		const close = vi.fn(async () => undefined)
		onDestroy(payload, close)
		onDestroy(payload, close)
		await payload.destroy()
		await payload.destroy()
		expect(close).toHaveBeenCalledTimes(1)
		expect(order).toEqual(['payload.destroy', 'payload.destroy'])
	})

	it('still destroys the instance when closing fails, saying so once', async () => {
		const order: string[] = []
		const payload = instance(order)
		onDestroy(payload, async () => {
			throw new Error('socket gone')
		})
		await expect(payload.destroy()).resolves.toBeUndefined()
		expect(order).toEqual(['payload.destroy'])
		expect(payload.logger.warn).toHaveBeenCalledWith(expect.stringContaining('socket gone'))
	})

	it('keeps each instance apart', async () => {
		const first = instance([])
		const second = instance([])
		onDestroy(first, async () => undefined)
		onDestroy(second, async () => undefined)
		await first.destroy()
		expect(isDestroyed(first)).toBe(true)
		expect(isDestroyed(second)).toBe(false)
	})
})
