import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { SECRET_REVEAL_CONTEXT } from '../constants'
import { withRevealWindow } from './revealWindow'

const req = (context: Record<string, unknown> = {}) => ({ context }) as unknown as PayloadRequest

describe('withRevealWindow', () => {
	it('opens the flag for the read and closes it after', async () => {
		const r = req()
		const seen = await withRevealWindow(r, SECRET_REVEAL_CONTEXT.forSigning, async () =>
			Boolean(r.context[SECRET_REVEAL_CONTEXT.forSigning])
		)
		expect(seen).toBe(true)
		expect(r.context[SECRET_REVEAL_CONTEXT.forSigning]).toBeUndefined()
	})

	/**
	 * Clearing on the way out instead of restoring would close a window the caller still needs, and
	 * the next read on that request would see the mask rather than key material.
	 */
	it('restores an outer window rather than closing it', async () => {
		const r = req({ [SECRET_REVEAL_CONTEXT.forSigning]: true })
		await withRevealWindow(r, SECRET_REVEAL_CONTEXT.forSigning, async () => undefined)
		expect(r.context[SECRET_REVEAL_CONTEXT.forSigning]).toBe(true)
	})

	it('restores the previous value when the read throws', async () => {
		const r = req({ [SECRET_REVEAL_CONTEXT.raw]: true })
		await expect(
			withRevealWindow(r, SECRET_REVEAL_CONTEXT.raw, async () => {
				throw new Error('boom')
			})
		).rejects.toThrow('boom')
		expect(r.context[SECRET_REVEAL_CONTEXT.raw]).toBe(true)
	})

	it('keeps separate flags independent', async () => {
		const r = req()
		await withRevealWindow(r, SECRET_REVEAL_CONTEXT.raw, async () => {
			expect(r.context[SECRET_REVEAL_CONTEXT.raw]).toBe(true)
			expect(r.context[SECRET_REVEAL_CONTEXT.forSigning]).toBeUndefined()
		})
	})
})
