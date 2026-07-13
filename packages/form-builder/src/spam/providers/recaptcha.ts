import { defineCaptchaProvider } from '../captcha'
import type { CaptchaProvider } from '../types'
import { DEFAULT_SITEVERIFY_TIMEOUT, postSiteverify, siteverifyParams } from './siteverify'

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'
const DEFAULT_MIN_SCORE = 0.5

export type RecaptchaProviderOptions = {
	/** reCAPTCHA secret key (server-side, never the site key). */
	secretKey: string
	/**
	 * Minimum acceptable v3 score (0 to 1). Applied only when the response carries a score,
	 * defaulting to 0.5; v2 responses have no score and pass on `success` alone.
	 */
	minScore?: number
	/** Override the siteverify endpoint. */
	verifyUrl?: string
	/** Header read for the client IP forwarded as `remoteip`. Default 'x-forwarded-for'. */
	ipHeader?: string
	/** Verification request timeout in ms. Default 5000. */
	timeoutMs?: number
}

/**
 * Google reCAPTCHA verification adapter for both v2 (checkbox) and v3 (score) tokens. A v3
 * response must also meet `minScore`. Network errors, timeouts, and non-2xx responses fail
 * closed (the submission is rejected).
 */
export const recaptchaProvider = (options: RecaptchaProviderOptions): CaptchaProvider =>
	defineCaptchaProvider({
		type: 'recaptcha',
		verify: async ({ token, req }) => {
			const result = await postSiteverify(
				options.verifyUrl ?? RECAPTCHA_VERIFY_URL,
				siteverifyParams(options, token, req),
				options.timeoutMs ?? DEFAULT_SITEVERIFY_TIMEOUT
			)
			if (result?.success !== true) {
				return false
			}
			if (typeof result.score === 'number') {
				return result.score >= (options.minScore ?? DEFAULT_MIN_SCORE)
			}
			return true
		},
	})
