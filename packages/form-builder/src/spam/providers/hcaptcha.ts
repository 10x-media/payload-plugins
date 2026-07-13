import { defineCaptchaProvider } from '../captcha'
import type { CaptchaProvider } from '../types'
import { DEFAULT_SITEVERIFY_TIMEOUT, postSiteverify, siteverifyParams } from './siteverify'

const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify'

export type HcaptchaProviderOptions = {
	/** hCaptcha secret key (server-side, never the site key). */
	secretKey: string
	/** Override the siteverify endpoint. */
	verifyUrl?: string
	/** Header read for the client IP forwarded as `remoteip`. Default 'x-forwarded-for'. */
	ipHeader?: string
	/** Verification request timeout in ms. Default 5000. */
	timeoutMs?: number
}

/**
 * hCaptcha verification adapter. Network errors, timeouts, and non-2xx responses fail closed
 * (the submission is rejected).
 */
export const hcaptchaProvider = (options: HcaptchaProviderOptions): CaptchaProvider =>
	defineCaptchaProvider({
		type: 'hcaptcha',
		verify: async ({ token, req }) => {
			const result = await postSiteverify(
				options.verifyUrl ?? HCAPTCHA_VERIFY_URL,
				siteverifyParams(options, token, req),
				options.timeoutMs ?? DEFAULT_SITEVERIFY_TIMEOUT
			)
			return result?.success === true
		},
	})
