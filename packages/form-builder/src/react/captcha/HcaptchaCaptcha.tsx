'use client'

import { type Ref, useEffect, useImperativeHandle, useRef } from 'react'
import type { FormAdapters } from '../adapters'
import type { CaptchaWidgetHandle } from './types'
import { useCaptchaScript } from './useCaptchaScript'
import { getHcaptcha } from './vendors'

export const HCAPTCHA_SCRIPT_URL = 'https://js.hcaptcha.com/1/api.js?render=explicit'

export type HcaptchaCaptchaProps = {
	/** hCaptcha site key (public). */
	siteKey: string
	/** Receives each fresh token, and null when the token expires or errors. */
	onToken: (token: string | null) => void
	/** Extra vendor render params (theme, size, ...). */
	options?: Record<string, unknown>
	className?: string
	/** Override the vendor script URL. */
	scriptSrc?: string
	/** Host-owned effects; only `loadScript` applies here (consent-gated or CSP-nonced script loading). */
	adapters?: Pick<FormAdapters, 'loadScript'>
	ref?: Ref<CaptchaWidgetHandle>
}

/**
 * Headless hCaptcha widget: loads the vendor script once, renders the widget into a bare div,
 * and reports tokens through `onToken`. Pass the latest token to `<Form captchaToken>`.
 */
export const HcaptchaCaptcha = ({
	siteKey,
	onToken,
	options,
	className,
	scriptSrc = HCAPTCHA_SCRIPT_URL,
	adapters,
	ref,
}: HcaptchaCaptchaProps) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const widgetIdRef = useRef<string | null>(null)
	const onTokenRef = useRef(onToken)
	onTokenRef.current = onToken
	const optionsRef = useRef(options)
	optionsRef.current = options
	const ready = useCaptchaScript(scriptSrc, adapters?.loadScript)

	useImperativeHandle(
		ref,
		() => ({
			reset: () => {
				const api = getHcaptcha()
				if (api && widgetIdRef.current !== null) {
					api.reset(widgetIdRef.current)
				}
				onTokenRef.current(null)
			},
		}),
		[]
	)

	useEffect(() => {
		if (!ready) {
			return
		}
		const container = containerRef.current
		const api = getHcaptcha()
		if (!container || !api) {
			return
		}
		const widgetId = api.render(container, {
			...optionsRef.current,
			sitekey: siteKey,
			callback: (token: string) => onTokenRef.current(token),
			'expired-callback': () => onTokenRef.current(null),
			'error-callback': () => onTokenRef.current(null),
		})
		widgetIdRef.current = widgetId
		return () => {
			widgetIdRef.current = null
			try {
				api.remove(widgetId)
			} catch {}
		}
	}, [ready, siteKey])

	return <div ref={containerRef} className={className} />
}
