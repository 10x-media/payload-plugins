import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { memoForRequest } from './memoForRequest'

const fakeReq = () => ({}) as PayloadRequest

describe('memoForRequest', () => {
	it('runs the function once per request and key', async () => {
		const req = fakeReq()
		const key = Symbol('presets')
		const fn = vi.fn(async () => 'value')
		await expect(memoForRequest(req, key, fn)).resolves.toBe('value')
		await expect(memoForRequest(req, key, fn)).resolves.toBe('value')
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it('keeps entries separate per key on the same request', async () => {
		const req = fakeReq()
		await expect(memoForRequest(req, Symbol('a'), async () => 1)).resolves.toBe(1)
		await expect(memoForRequest(req, Symbol('b'), async () => 2)).resolves.toBe(2)
	})

	it('keeps entries separate per request for the same key', async () => {
		const key = Symbol('shared')
		let calls = 0
		const fn = vi.fn(async () => {
			calls += 1
			return calls
		})
		await expect(memoForRequest(fakeReq(), key, fn)).resolves.toBe(1)
		await expect(memoForRequest(fakeReq(), key, fn)).resolves.toBe(2)
		expect(fn).toHaveBeenCalledTimes(2)
	})

	it('shares in-flight promises, not just settled values', async () => {
		const req = fakeReq()
		const key = Symbol('inflight')
		let resolveIt: (value: string) => void = () => {}
		const fn = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveIt = resolve
				})
		)
		const first = memoForRequest(req, key, fn)
		const second = memoForRequest(req, key, fn)
		expect(fn).toHaveBeenCalledTimes(1)
		resolveIt('done')
		await expect(first).resolves.toBe('done')
		await expect(second).resolves.toBe('done')
	})

	it('caches rejections for the same request', async () => {
		const req = fakeReq()
		const key = Symbol('failing')
		const fn = vi.fn(async () => {
			throw new Error('boom')
		})
		await expect(memoForRequest(req, key, fn)).rejects.toThrow('boom')
		await expect(memoForRequest(req, key, fn)).rejects.toThrow('boom')
		expect(fn).toHaveBeenCalledTimes(1)
	})
})
