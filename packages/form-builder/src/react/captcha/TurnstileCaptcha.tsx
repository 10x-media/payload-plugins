'use client'

import { type Ref, useEffect, useImperativeHandle, useRef } from 'react'
import type { FormAdapters } from '../adapters'
import type { CaptchaWidgetHandle } from './types'
import { useCaptchaScript } from './useCaptchaScript'
import { getTurnstile } from './vendors'

export const TURNSTILE_SCRIPT_URL =
	'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export type TurnstileCaptchaProps = {
	/** Turnstile site key (public). */
	siteKey: string
	/** Receives each fresh token, and null when the token expires or errors. */
	onToken: (token: string | null) => void
	/** Extra vendor render params (theme, size, appearance, ...). */
	options?: Record<string, unknown>
	className?: string
	/** Override the vendor script URL. */
	scriptSrc?: string
	/** Host-owned effects; only `loadScript` applies here (consent-gated or CSP-nonced script loading). */
	adapters?: Pick<FormAdapters, 'loadScript'>
	ref?: Ref<CaptchaWidgetHandle>
}

/**
 * Headless Cloudflare Turnstile widget: loads the vendor script once, renders the widget into a
 * bare div, and reports tokens through `onToken`. Pass the latest token to `<Form captchaToken>`.
 */
export const TurnstileCaptcha = ({
	siteKey,
	onToken,
	options,
	className,
	scriptSrc = TURNSTILE_SCRIPT_URL,
	adapters,
	ref,
}: TurnstileCaptchaProps) => {
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
				const api = getTurnstile()
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
		const api = getTurnstile()
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
