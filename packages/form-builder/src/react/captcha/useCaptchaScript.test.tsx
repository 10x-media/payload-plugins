import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
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
