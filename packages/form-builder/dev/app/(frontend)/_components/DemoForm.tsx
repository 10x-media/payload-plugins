'use client'

import {
	buildFieldTypeRegistry,
	type FormDocument,
	type FormFieldInstance,
	valuesFromSearchParams,
} from '@10x-media/form-builder/react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { customRules } from '../../../helpers/rules'
import { dateRenderer } from './fields/date'
import { WizardForm } from './WizardForm'

declare global {
	interface Window {
		turnstile?: {
			render: (
				el: string | HTMLElement,
				opts: { sitekey: string; callback: (token: string) => void }
			) => string
			remove: (widgetId: string) => void
			reset: (widgetId: string) => void
		}
		onTurnstileLoad?: () => void
	}
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''

export function DemoForm({ form }: { form: unknown }) {
	const [captchaToken, setCaptchaToken] = useState<string | undefined>()
	const widgetIdRef = useRef<string>('')
	const searchParams = useSearchParams()
	const doc = form as FormDocument

	const initialValues = useMemo(
		() =>
			valuesFromSearchParams(
				searchParams,
				doc.fields as FormFieldInstance[],
				buildFieldTypeRegistry(),
			),
		[searchParams, doc.fields],
	)

	useEffect(() => {
		const script = document.createElement('script')
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'
		script.async = true
		script.defer = true

		window.onTurnstileLoad = () => {
			const el = document.getElementById('turnstile-widget')
			if (el && window.turnstile) {
				widgetIdRef.current = window.turnstile.render(el, {
					sitekey: SITE_KEY,
					callback: (token: string) => setCaptchaToken(token),
				})
			}
		}

		document.head.appendChild(script)
		return () => {
			if (widgetIdRef.current && window.turnstile) {
				window.turnstile.remove(widgetIdRef.current)
			}
			script.remove()
		}
	}, [])

	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Demo form</h1>
			<div id="turnstile-widget" style={{ marginBottom: '1rem' }} />
			<WizardForm
				form={doc}
				renderers={{ date: dateRenderer }}
				rules={customRules}
				captchaToken={captchaToken}
				initialValues={initialValues}
				presentation="wizard"
			/>
		</main>
	)
}
