import { render, waitFor } from '@testing-library/react'
import { act, createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TURNSTILE_SCRIPT_URL, TurnstileCaptcha } from './TurnstileCaptcha'
import type { CaptchaWidgetHandle } from './types'
import type { TurnstileRenderParams } from './vendors'

type TurnstileMock = {
	render: ReturnType<typeof vi.fn>
	reset: ReturnType<typeof vi.fn>
	remove: ReturnType<typeof vi.fn>
}

let turnstile: TurnstileMock
let renderedParams: TurnstileRenderParams | undefined

const loadVendorScript = () =>
	act(() => {
		for (const el of document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`)) {
			el.dispatchEvent(new Event('load'))
		}
	})

beforeEach(() => {
	renderedParams = undefined
	turnstile = {
		render: vi.fn((_el: HTMLElement, params: TurnstileRenderParams) => {
			renderedParams = params
			return 'widget-1'
		}),
		reset: vi.fn(),
		remove: vi.fn(),
	}
	;(globalThis as { turnstile?: TurnstileMock }).turnstile = turnstile
})

afterEach(() => {
	;(globalThis as { turnstile?: TurnstileMock }).turnstile = undefined
})

describe('TurnstileCaptcha', () => {
	it('renders the widget into its container with sitekey and extra options', async () => {
		const { container } = render(
			<TurnstileCaptcha
				siteKey="site-1"
				onToken={() => {}}
				options={{ theme: 'dark' }}
				className="captcha-slot"
			/>
		)
		loadVendorScript()
		await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1))
		const [element, params] = turnstile.render.mock.calls[0] as [HTMLElement, TurnstileRenderParams]
		expect(element).toBe(container.querySelector('.captcha-slot'))
		expect(params.sitekey).toBe('site-1')
		expect(params.theme).toBe('dark')
	})

	it('propagates tokens and clears them on expiry and error', async () => {
		const onToken = vi.fn()
		render(<TurnstileCaptcha siteKey="site-1" onToken={onToken} />)
		loadVendorScript()
		await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
		act(() => renderedParams?.callback?.('tok-1'))
		expect(onToken).toHaveBeenLastCalledWith('tok-1')
		act(() => renderedParams?.['expired-callback']?.())
		expect(onToken).toHaveBeenLastCalledWith(null)
		act(() => renderedParams?.callback?.('tok-2'))
		act(() => renderedParams?.['error-callback']?.())
		expect(onToken).toHaveBeenLastCalledWith(null)
	})

	it('exposes reset through the handle and removes the widget on unmount', async () => {
		const ref = createRef<CaptchaWidgetHandle>()
		const { unmount } = render(<TurnstileCaptcha ref={ref} siteKey="site-1" onToken={() => {}} />)
		loadVendorScript()
		await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
		act(() => ref.current?.reset())
		expect(turnstile.reset).toHaveBeenCalledWith('widget-1')
		unmount()
		expect(turnstile.remove).toHaveBeenCalledWith('widget-1')
	})
})
