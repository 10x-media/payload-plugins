'use client'

import { type Ref, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { FormAdapters } from '../adapters'
import type { CaptchaWidgetHandle } from './types'
import { useCaptchaScript } from './useCaptchaScript'
import { getGrecaptcha } from './vendors'

export const RECAPTCHA_SCRIPT_URL = 'https://www.google.com/recaptcha/api.js'

export type RecaptchaCaptchaHandle = CaptchaWidgetHandle & {
	/**
	 * v3 only: fetch a fresh token on demand and report it through `onToken`. v3 tokens expire
	 * after about two minutes, so call this right before submit for a long-lived form. Resolves
	 * null for v2 or when execution fails.
	 */
	execute: (action?: string) => Promise<string | null>
}

export type RecaptchaCaptchaProps = {
	/** reCAPTCHA site key (public). */
	siteKey: string
	/** 'v2' renders the checkbox widget; 'v3' runs invisibly and produces score-based tokens. */
	version: 'v2' | 'v3'
	/** v3 action name reported to reCAPTCHA. Default 'submit'. */
	action?: string
	/** Receives each fresh token, and null when the token expires, errors, or is reset. */
	onToken: (token: string | null) => void
	/** Extra vendor render params for v2 (theme, size, ...). */
	options?: Record<string, unknown>
	className?: string
	/** Override the vendor script URL (the version-specific `render` query is not appended). */
	scriptSrc?: string
	/** Host-owned effects; only `loadScript` applies here (consent-gated or CSP-nonced script loading). */
	adapters?: Pick<FormAdapters, 'loadScript'>
	ref?: Ref<RecaptchaCaptchaHandle>
}

/**
 * Headless Google reCAPTCHA widget for v2 (checkbox) and v3 (invisible, score-based). v2 reports
 * tokens as the user solves the challenge; v3 fetches an initial token on mount and exposes
 * `execute` on the ref for on-demand refresh. Pass the latest token to `<Form captchaToken>`.
 */
export const RecaptchaCaptcha = ({
	siteKey,
	version,
	action,
	onToken,
	options,
	className,
	scriptSrc,
	adapters,
	ref,
}: RecaptchaCaptchaProps) => {
	const src =
		scriptSrc ?? `${RECAPTCHA_SCRIPT_URL}?render=${version === 'v3' ? siteKey : 'explicit'}`
	const containerRef = useRef<HTMLDivElement>(null)
	const widgetIdRef = useRef<number | null>(null)
	const onTokenRef = useRef(onToken)
	onTokenRef.current = onToken
	const optionsRef = useRef(options)
	optionsRef.current = options
	const actionRef = useRef(action)
	actionRef.current = action
	const ready = useCaptchaScript(src, adapters?.loadScript)

	const execute = useCallback(
		async (overrideAction?: string): Promise<string | null> => {
			const api = getGrecaptcha()
			if (!api || version !== 'v3') {
				return null
			}
			try {
				const token = await api.execute(siteKey, {
					action: overrideAction ?? actionRef.current ?? 'submit',
				})
				onTokenRef.current(token)
				return token
			} catch {
				onTokenRef.current(null)
				return null
			}
		},
		[siteKey, version]
	)

	useImperativeHandle(
		ref,
		() => ({
			reset: () => {
				const api = getGrecaptcha()
				if (api && version === 'v2' && widgetIdRef.current !== null) {
					api.reset(widgetIdRef.current)
				}
				onTokenRef.current(null)
			},
			execute,
		}),
		[execute, version]
	)

	useEffect(() => {
		if (!ready) {
			return
		}
		const api = getGrecaptcha()
		if (!api) {
			return
		}
		let active = true
		if (version === 'v3') {
			api.ready(() => {
				if (active) {
					void execute()
				}
			})
			return () => {
				active = false
			}
		}
		const container = containerRef.current
		if (!container) {
			return
		}
		api.ready(() => {
			if (!active || widgetIdRef.current !== null) {
				return
			}
			widgetIdRef.current = api.render(container, {
				...optionsRef.current,
				sitekey: siteKey,
				callback: (token: string) => onTokenRef.current(token),
				'expired-callback': () => onTokenRef.current(null),
				'error-callback': () => onTokenRef.current(null),
			})
		})
		return () => {
			active = false
			if (widgetIdRef.current !== null) {
				try {
					api.reset(widgetIdRef.current)
				} catch {}
				widgetIdRef.current = null
			}
			// grecaptcha has no remove(); clearing the container drops the detached widget DOM.
			container.replaceChildren()
		}
	}, [ready, siteKey, version, execute])

	return <div ref={containerRef} className={className} />
}
