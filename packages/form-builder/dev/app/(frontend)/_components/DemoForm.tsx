// biome-ignore-all lint/plugin/noProcessEnv: dev frontend env boundary
'use client'

import {
	buildFieldTypeRegistry,
	type FormDocument,
	type FormFieldInstance,
	valuesFromSearchParams,
} from '@10x-media/form-builder/react'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { customRules } from '../../../helpers/rules'
import { dateRenderer } from './fields/date'
import { WizardForm } from './WizardForm'

declare global {
	interface Window {
		turnstile?: {
			render: (
				el: string | HTMLElement,
				opts: {
					sitekey: string
					callback: (token: string) => void
					'error-callback'?: () => void
					'expired-callback'?: () => void
				}
			) => string
			remove: (widgetId: string) => void
			reset: (widgetId: string) => void
		}
	}
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

type CaptchaStatus = 'loading' | 'ready' | 'expired' | 'error'

export function DemoForm({ form }: { form: unknown }) {
	const [captchaToken, setCaptchaToken] = useState<string | undefined>()
	const [captchaStatus, setCaptchaStatus] = useState<CaptchaStatus>('loading')
	const widgetIdRef = useRef<string>('')
	const containerRef = useRef<HTMLDivElement>(null)
	const searchParams = useSearchParams()

	const doc = form as FormDocument
	if (
		process.env.NODE_ENV !== 'production' &&
		(!doc || !Array.isArray((doc as FormDocument).fields))
	) {
		// eslint-disable-next-line no-console
		console.warn('[DemoForm] `form` does not look like a FormDocument (missing `fields[]`).')
	}

	const eventSink = useMemo(
		() => ({
			emit: (event: unknown) => {
				if (process.env.NODE_ENV !== 'production') {
					// eslint-disable-next-line no-console
					console.log('[Form Event]', event)
				}
			},
		}),
		[]
	)

	const initialValues = useMemo(
		() =>
			valuesFromSearchParams(
				searchParams,
				doc.fields as FormFieldInstance[],
				buildFieldTypeRegistry()
			),
		[searchParams, doc.fields]
	)

	const renderWidget = useCallback(() => {
		const el = containerRef.current
		if (!el || !window.turnstile || !SITE_KEY) return
		widgetIdRef.current = window.turnstile.render(el, {
			sitekey: SITE_KEY,
			callback: (token) => {
				setCaptchaToken(token)
				setCaptchaStatus('ready')
			},
			'expired-callback': () => {
				setCaptchaToken(undefined)
				setCaptchaStatus('expired')
			},
			'error-callback': () => setCaptchaStatus('error'),
		})
	}, [])

	useEffect(() => {
		if (!SITE_KEY && process.env.NODE_ENV !== 'production') {
			// eslint-disable-next-line no-console
			console.warn('[DemoForm] NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set.')
		}

		let cancelled = false

		if (window.turnstile) {
			renderWidget()
		} else {
			const existing = document.querySelector<HTMLScriptElement>(
				`script[src^="${TURNSTILE_SCRIPT_SRC}"]`
			)
			const script = existing ?? document.createElement('script')
			if (!existing) {
				script.src = TURNSTILE_SCRIPT_SRC
				script.async = true
				script.defer = true
				document.head.appendChild(script)
			}
			script.addEventListener('load', () => {
				if (!cancelled) renderWidget()
			})
		}

		return () => {
			cancelled = true
			if (widgetIdRef.current && window.turnstile) {
				window.turnstile.remove(widgetIdRef.current)
				widgetIdRef.current = ''
			}
		}
	}, [renderWidget])

	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Demo form</h1>
			<div style={{ marginBottom: '1rem', minHeight: 65 }}>
				{/* Turnstile injects its widget directly into this node; keep it free of React-managed children. */}
				<div ref={containerRef} />
				<p aria-live="polite" style={{ margin: captchaStatus === 'ready' ? 0 : '4px 0 0' }}>
					{captchaStatus === 'loading' && 'Loading verification…'}
					{captchaStatus === 'expired' && 'Verification expired, please try again.'}
					{captchaStatus === 'error' && 'Verification failed to load.'}
				</p>
			</div>
			<WizardForm
				form={doc}
				events={eventSink}
				renderers={{ date: dateRenderer }}
				rules={customRules}
				captchaToken={captchaToken}
				initialValues={initialValues}
			/>
		</main>
	)
}
