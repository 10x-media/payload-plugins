import { describe, expect, it, vi } from 'vitest'

import { isLockLifted, withoutContentLock } from './bypass'

describe('withoutContentLock', () => {
	it('lifts the lock for the callback and everything it awaits, and only there', async () => {
		expect(isLockLifted()).toBe(false)
		await withoutContentLock(async () => {
			expect(isLockLifted()).toBe(true)
			await new Promise((resolve) => setTimeout(resolve, 1))
			expect(isLockLifted()).toBe(true)
		})
		expect(isLockLifted()).toBe(false)
	})

	it('keeps concurrent async chains apart', async () => {
		let release: () => void = () => undefined
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const inside = withoutContentLock(async () => {
			await gate
			return isLockLifted()
		})
		const outside = (async () => {
			await gate
			return isLockLifted()
		})()
		release()
		expect(await Promise.all([inside, outside])).toEqual([true, false])
	})

	it('returns what the callback returns and rejects with what it throws', async () => {
		await expect(withoutContentLock(() => 42)).resolves.toBe(42)
		await expect(
			withoutContentLock(() => {
				throw new Error('migration failed')
			})
		).rejects.toThrow('migration failed')
	})

	it('shares one scope between evaluated copies of the module', async () => {
		vi.resetModules()
		const copy = await import('./bypass')
		expect(copy.isLockLifted).not.toBe(isLockLifted)
		await withoutContentLock(async () => {
			expect(copy.isLockLifted()).toBe(true)
		})
		await copy.withoutContentLock(async () => {
			expect(isLockLifted()).toBe(true)
		})
	})
})
