import { render, waitFor } from '@testing-library/react'
import { act, createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HCAPTCHA_SCRIPT_URL, HcaptchaCaptcha } from './HcaptchaCaptcha'
import type { CaptchaWidgetHandle } from './types'
import type { HcaptchaRenderParams } from './vendors'

type HcaptchaMock = {
	render: ReturnType<typeof vi.fn>
	reset: ReturnType<typeof vi.fn>
	remove: ReturnType<typeof vi.fn>
}

let hcaptcha: HcaptchaMock
let renderedParams: HcaptchaRenderParams | undefined

const loadVendorScript = () =>
	act(() => {
		for (const el of document.querySelectorAll(`script[src="${HCAPTCHA_SCRIPT_URL}"]`)) {
			el.dispatchEvent(new Event('load'))
		}
	})

beforeEach(() => {
	renderedParams = undefined
	hcaptcha = {
		render: vi.fn((_el: HTMLElement, params: HcaptchaRenderParams) => {
			renderedParams = params
			return 'hc-widget'
		}),
		reset: vi.fn(),
		remove: vi.fn(),
	}
	;(globalThis as { hcaptcha?: HcaptchaMock }).hcaptcha = hcaptcha
})

afterEach(() => {
	;(globalThis as { hcaptcha?: HcaptchaMock }).hcaptcha = undefined
})

describe('HcaptchaCaptcha', () => {
	it('renders the widget with sitekey and extra options', async () => {
		const { container } = render(
			<HcaptchaCaptcha siteKey="hc-site" onToken={() => {}} options={{ size: 'compact' }} />
		)
		loadVendorScript()
		await waitFor(() => expect(hcaptcha.render).toHaveBeenCalledTimes(1))
		const [element, params] = hcaptcha.render.mock.calls[0] as [HTMLElement, HcaptchaRenderParams]
		expect(element).toBe(container.firstElementChild)
		expect(params.sitekey).toBe('hc-site')
		expect(params.size).toBe('compact')
	})

	it('propagates tokens and clears them on expiry and error', async () => {
		const onToken = vi.fn()
		render(<HcaptchaCaptcha siteKey="hc-site" onToken={onToken} />)
		loadVendorScript()
		await waitFor(() => expect(hcaptcha.render).toHaveBeenCalled())
		act(() => renderedParams?.callback?.('hc-tok'))
		expect(onToken).toHaveBeenLastCalledWith('hc-tok')
		act(() => renderedParams?.['expired-callback']?.())
		expect(onToken).toHaveBeenLastCalledWith(null)
		act(() => renderedParams?.['error-callback']?.())
		expect(onToken).toHaveBeenLastCalledWith(null)
	})

	it('exposes reset through the handle and removes the widget on unmount', async () => {
		const ref = createRef<CaptchaWidgetHandle>()
		const { unmount } = render(<HcaptchaCaptcha ref={ref} siteKey="hc-site" onToken={() => {}} />)
		loadVendorScript()
		await waitFor(() => expect(hcaptcha.render).toHaveBeenCalled())
		act(() => ref.current?.reset())
		expect(hcaptcha.reset).toHaveBeenCalledWith('hc-widget')
		unmount()
		expect(hcaptcha.remove).toHaveBeenCalledWith('hc-widget')
	})
})
