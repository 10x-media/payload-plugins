import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useCaptchaScript } from './useCaptchaScript'

const scriptsFor = (src: string) => document.querySelectorAll(`script[src="${src}"]`)

const fire = (src: string, event: string) =>
	act(() => {
		for (const el of scriptsFor(src)) {
			el.dispatchEvent(new Event(event))
		}
	})

describe('useCaptchaScript', () => {
	it('injects the script once for concurrent consumers and reports ready on load', async () => {
		const src = 'https://vendor.test/one.js'
		const first = renderHook(() => useCaptchaScript(src))
		const second = renderHook(() => useCaptchaScript(src))
		expect(scriptsFor(src)).toHaveLength(1)
		expect(first.result.current).toBe(false)
		fire(src, 'load')
		await waitFor(() => expect(first.result.current).toBe(true))
		await waitFor(() => expect(second.result.current).toBe(true))
	})

	it('stays ready for late consumers without re-injecting', async () => {
		const src = 'https://vendor.test/two.js'
		renderHook(() => useCaptchaScript(src))
		fire(src, 'load')
		const late = renderHook(() => useCaptchaScript(src))
		await waitFor(() => expect(late.result.current).toBe(true))
		expect(scriptsFor(src)).toHaveLength(1)
	})

	it('injects separate scripts for different srcs', () => {
		renderHook(() => useCaptchaScript('https://vendor.test/a.js'))
		renderHook(() => useCaptchaScript('https://vendor.test/b.js'))
		expect(scriptsFor('https://vendor.test/a.js')).toHaveLength(1)
		expect(scriptsFor('https://vendor.test/b.js')).toHaveLength(1)
	})

	it('uses a custom loadScript instead of injecting, cached per src', async () => {
		let resolveLoad!: () => void
		const loadScript = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveLoad = resolve
				})
		)
		const src = 'https://vendor.test/custom.js'
		const first = renderHook(() => useCaptchaScript(src, loadScript))
		const second = renderHook(() => useCaptchaScript(src, loadScript))
		expect(scriptsFor(src)).toHaveLength(0)
		expect(loadScript).toHaveBeenCalledTimes(1)
		expect(loadScript).toHaveBeenCalledWith(src)
		act(() => resolveLoad())
		await waitFor(() => expect(first.result.current).toBe(true))
		await waitFor(() => expect(second.result.current).toBe(true))
		expect(scriptsFor(src)).toHaveLength(0)
	})

	it('evicts a failed custom load so a later consumer retries', async () => {
		const src = 'https://vendor.test/custom-broken.js'
		const loadScript = vi
			.fn<(scriptSrc: string) => Promise<void>>()
			.mockRejectedValueOnce(new Error('blocked'))
			.mockResolvedValueOnce(undefined)
		const failed = renderHook(() => useCaptchaScript(src, loadScript))
		await waitFor(() => expect(loadScript).toHaveBeenCalledTimes(1))
		await act(async () => {})
		expect(failed.result.current).toBe(false)
		const retry = renderHook(() => useCaptchaScript(src, loadScript))
		await waitFor(() => expect(loadScript).toHaveBeenCalledTimes(2))
		await waitFor(() => expect(retry.result.current).toBe(true))
	})

	it('recovers from a load error by allowing a retry', async () => {
		const src = 'https://vendor.test/broken.js'
		const failed = renderHook(() => useCaptchaScript(src))
		fire(src, 'error')
		expect(failed.result.current).toBe(false)
		const retry = renderHook(() => useCaptchaScript(src))
		expect(scriptsFor(src)).toHaveLength(1)
		fire(src, 'load')
		await waitFor(() => expect(retry.result.current).toBe(true))
	})
})
