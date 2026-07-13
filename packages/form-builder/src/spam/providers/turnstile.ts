import { defineCaptchaProvider } from '../captcha'
import type { CaptchaProvider } from '../types'
import { DEFAULT_SITEVERIFY_TIMEOUT, postSiteverify, siteverifyParams } from './siteverify'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileProviderOptions = {
	/** Turnstile secret key (server-side, never the site key). */
	secretKey: string
	/** Override the siteverify endpoint. */
	verifyUrl?: string
	/** Header read for the client IP forwarded as `remoteip`. Default 'x-forwarded-for'. */
	ipHeader?: string
	/** Verification request timeout in ms. Default 5000. */
	timeoutMs?: number
}

/**
 * Cloudflare Turnstile verification adapter. Network errors, timeouts, and non-2xx responses
 * fail closed (the submission is rejected).
 */
export const turnstileProvider = (options: TurnstileProviderOptions): CaptchaProvider =>
	defineCaptchaProvider({
		type: 'turnstile',
		verify: async ({ token, req }) => {
			const result = await postSiteverify(
				options.verifyUrl ?? TURNSTILE_VERIFY_URL,
				siteverifyParams(options, token, req),
				options.timeoutMs ?? DEFAULT_SITEVERIFY_TIMEOUT
			)
			return result?.success === true
		},
	})
