'use client'

import { Form, type FormDocument } from '@10x-media/form-builder/react'
import { dateRenderer } from './fields/date'
import { customRules } from '../../../helpers/rules'

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

const SITE_KEY = '0x4AAAAAADzK40VZnwfFVOIJ'

export function DemoForm({ form }: { form: unknown }) {
	// const [captchaToken, setCaptchaToken] = useState<string | undefined>()
	// const widgetIdRef = useRef<string>('')

	// useEffect(() => {
	// 	const script = document.createElement('script')
	// 	script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad'
	// 	script.async = true
	// 	script.defer = true

	// 	window.onTurnstileLoad = () => {
	// 		const el = document.getElementById('turnstile-widget')
	// 		if (el && window.turnstile) {
	// 			widgetIdRef.current = window.turnstile.render(el, {
	// 				sitekey: SITE_KEY,
	// 				callback: (token: string) => setCaptchaToken(token),
	// 			})
	// 		}
	// 	}

	// 	document.head.appendChild(script)
	// 	return () => {
	// 		if (widgetIdRef.current && window.turnstile) {
	// 			window.turnstile.remove(widgetIdRef.current)
	// 		}
	// 		script.remove()
	// 	}
	// }, [])

	return (
		<main style={{ maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
			<h1>Demo form</h1>
			<div id="turnstile-widget" style={{ marginBottom: '1rem' }} />
			{/* {captchaToken ? (
				<p style={{ color: 'green', fontSize: '0.8rem' }}>Captcha verified</p>
			) : (
				<p style={{ color: 'red', fontSize: '0.8rem' }}>Solve captcha before submit</p>
			)} */}
			<Form form={form as FormDocument} renderers={{ date: dateRenderer }} rules={customRules} />
		</main>
	)
}
