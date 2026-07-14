import { render, waitFor } from '@testing-library/react'
import { act, createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecaptchaCaptchaHandle } from './RecaptchaCaptcha'
import { RECAPTCHA_SCRIPT_URL, RecaptchaCaptcha } from './RecaptchaCaptcha'
import type { RecaptchaRenderParams } from './vendors'

type GrecaptchaMock = {
	ready: ReturnType<typeof vi.fn>
	render: ReturnType<typeof vi.fn>
	reset: ReturnType<typeof vi.fn>
	execute: ReturnType<typeof vi.fn>
}

let grecaptcha: GrecaptchaMock
let renderedParams: RecaptchaRenderParams | undefined

const loadVendorScript = () =>
	act(() => {
		for (const el of document.querySelectorAll('script[src^="https://www.google.com/recaptcha"]')) {
			el.dispatchEvent(new Event('load'))
		}
	})

beforeEach(() => {
	renderedParams = undefined
	grecaptcha = {
		ready: vi.fn((cb: () => void) => cb()),
		render: vi.fn((_el: HTMLElement, params: RecaptchaRenderParams) => {
			renderedParams = params
			return 0
		}),
		reset: vi.fn(),
		execute: vi.fn(async () => 'v3-token'),
	}
	;(globalThis as { grecaptcha?: GrecaptchaMock }).grecaptcha = grecaptcha
})

afterEach(() => {
	;(globalThis as { grecaptcha?: GrecaptchaMock }).grecaptcha = undefined
})

describe('RecaptchaCaptcha v2', () => {
	it('loads the explicit-render script and renders the checkbox widget', async () => {
		const { container } = render(
			<RecaptchaCaptcha siteKey="site-2" version="v2" onToken={() => {}} />
		)
		expect(
			document.querySelector(`script[src="${RECAPTCHA_SCRIPT_URL}?render=explicit"]`)
		).not.toBeNull()
		loadVendorScript()
		await waitFor(() => expect(grecaptcha.render).toHaveBeenCalledTimes(1))
		const [element, params] = grecaptcha.render.mock.calls[0] as [
			HTMLElement,
			RecaptchaRenderParams,
		]
		expect(element).toBe(container.firstElementChild)
		expect(params.sitekey).toBe('site-2')
	})

	it('propagates tokens, clears on expiry, and resets through the handle', async () => {
		const onToken = vi.fn()
		const ref = createRef<RecaptchaCaptchaHandle>()
		render(<RecaptchaCaptcha ref={ref} siteKey="site-2" version="v2" onToken={onToken} />)
		loadVendorScript()
		await waitFor(() => expect(grecaptcha.render).toHaveBeenCalled())
		act(() => renderedParams?.callback?.('tok-v2'))
		expect(onToken).toHaveBeenLastCalledWith('tok-v2')
		act(() => renderedParams?.['expired-callback']?.())
		expect(onToken).toHaveBeenLastCalledWith(null)
		act(() => ref.current?.reset())
		expect(grecaptcha.reset).toHaveBeenCalledWith(0)
		expect(onToken).toHaveBeenLastCalledWith(null)
	})
})

describe('RecaptchaCaptcha v3', () => {
	it('loads the sitekey-render script and fetches an initial token with the action', async () => {
		const onToken = vi.fn()
		render(<RecaptchaCaptcha siteKey="site-3" version="v3" action="signup" onToken={onToken} />)
		expect(
			document.querySelector(`script[src="${RECAPTCHA_SCRIPT_URL}?render=site-3"]`)
		).not.toBeNull()
		loadVendorScript()
		await waitFor(() => expect(onToken).toHaveBeenCalledWith('v3-token'))
		expect(grecaptcha.execute).toHaveBeenCalledWith('site-3', { action: 'signup' })
		expect(grecaptcha.render).not.toHaveBeenCalled()
	})

	it('exposes execute for on-demand refresh and fails to null', async () => {
		const onToken = vi.fn()
		const ref = createRef<RecaptchaCaptchaHandle>()
		render(<RecaptchaCaptcha ref={ref} siteKey="site-3" version="v3" onToken={onToken} />)
		loadVendorScript()
		await waitFor(() => expect(onToken).toHaveBeenCalledWith('v3-token'))
		grecaptcha.execute.mockResolvedValueOnce('fresh-token')
		const fresh = await act(() => ref.current?.execute('checkout'))
		expect(fresh).toBe('fresh-token')
		expect(grecaptcha.execute).toHaveBeenLastCalledWith('site-3', { action: 'checkout' })
		expect(onToken).toHaveBeenLastCalledWith('fresh-token')
		grecaptcha.execute.mockRejectedValueOnce(new Error('nope'))
		const failed = await act(() => ref.current?.execute())
		expect(failed).toBeNull()
		expect(onToken).toHaveBeenLastCalledWith(null)
	})
})
