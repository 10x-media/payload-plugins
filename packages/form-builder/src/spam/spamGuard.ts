import { APIError, type CollectionBeforeValidateHook, type PayloadRequest } from 'payload'
import type { SubmissionValue } from '../submissions/types'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'
import { firstHop } from './clientIp'
import { IDENTITY_CONTEXT_KEY } from './constants'
import { extractReservedValues, isHoneypotTripped } from './reserved'
import type { ResolvedSpamConfig } from './types'

let warnedRateLimitSkipped = false

/** Warn once per process when rate limiting is configured but skipped for lack of a request identity. */
const warnRateLimitSkippedOnce = (req: PayloadRequest): void => {
	if (warnedRateLimitSkipped) {
		return
	}
	warnedRateLimitSkipped = true
	req.payload.logger?.warn(
		'@10x-media/form-builder: submission rate limiting is configured but skipped for a request with no resolvable identity (no user and no client IP). Set spam.ipHeader for your proxy or provide a custom spam.identify.'
	)
}

/**
 * Submissions spam guard, prepended before `validateSubmission` in `beforeValidate` so it rejects before
 * the form load + field validation. On create it: resolves the request identity once (stashing it on
 * `req.context` for upload-ownership verification downstream); rate-limits per form + identity (429,
 * fail-open when identity is null); strips reserved `values` entries (honeypot, captcha token); rejects a
 * filled honeypot with a generic error; verifies a configured captcha; and writes a server-authoritative
 * `meta` (timestamp + spam signal, with opt-in ip/ua). App-level rate limiting is defense-in-depth that
 * complements edge/CDN/WAF limiting, not a DoS replacement.
 */
export const buildSpamGuard =
	(spam: ResolvedSpamConfig): CollectionBeforeValidateHook =>
	async ({ data, operation, req }) => {
		if (operation !== 'create' || !data) {
			return data
		}
		const t = asTranslate(req.i18n.t)
		// Honeypot + captcha are anti-bot measures for the anonymous public path; an authenticated request
		// (admin panel, logged-in API client) is already gated by auth and never carries a decoy/token, so
		// checking it would falsely reject legitimate authed creates. Rate-limit + ownership still apply.
		const authenticated = Boolean(req.user)

		const identity = await spam.identify(req)
		if (identity != null) {
			req.context[IDENTITY_CONTEXT_KEY] = identity
		}

		let rateLimitState: 'enforced' | 'skipped-no-identity' | 'disabled'
		if (spam.rateLimit === false) {
			rateLimitState = 'disabled'
		} else if (identity == null) {
			// Fail open (an unidentifiable submitter cannot be keyed) but never silently: record it on
			// meta.spam and warn once, so a deployment with no proxy or a misconfigured ipHeader is visible.
			rateLimitState = 'skipped-no-identity'
			warnRateLimitSkippedOnce(req)
		} else {
			const formKey = data.form != null ? String(data.form) : 'unknown'
			const { ok } = await spam.rateLimit.limiter.check({
				key: `submissions:${formKey}:${identity}`,
				max: spam.rateLimit.max,
				window: spam.rateLimit.window,
				req,
			})
			if (!ok) {
				throw new APIError(t(keys.spamRateLimited), 429)
			}
			rateLimitState = 'enforced'
		}

		const honeypotField = spam.honeypot === false ? null : spam.honeypot.fieldName
		const values = (data.values as SubmissionValue[] | undefined) ?? []
		const { cleaned, honeypot, captchaToken } = extractReservedValues(values, honeypotField)
		data.values = cleaned

		if (!authenticated && honeypotField !== null && isHoneypotTripped(honeypot)) {
			throw new APIError(t(keys.spamRejected), 400)
		}

		const captchaChecked = Boolean(spam.captcha) && !authenticated
		if (spam.captcha && !authenticated) {
			const passed =
				typeof captchaToken === 'string' && captchaToken.length > 0
					? await spam.captcha.verify({ token: captchaToken, req }).catch(() => false)
					: false
			if (!passed) {
				throw new APIError(t(keys.spamCaptchaFailed), 400)
			}
		}

		const serverMeta: Record<string, unknown> = {
			at: new Date().toISOString(),
			spam: { captcha: captchaChecked ? 'passed' : 'skipped', rateLimit: rateLimitState },
		}
		if (spam.metadata.ip) {
			const ip = firstHop(req.headers, spam.ipHeader)
			if (ip) {
				serverMeta.ip = ip
			}
		}
		if (spam.metadata.ua) {
			const ua = req.headers?.get('user-agent')
			if (ua) {
				serverMeta.ua = ua
			}
		}
		// Preserve an authenticated (trusted) caller's own `meta` keys, with server fields winning. Anonymous
		// `meta` is never trusted, so it is discarded.
		const clientMeta =
			authenticated && data.meta != null && typeof data.meta === 'object'
				? (data.meta as Record<string, unknown>)
				: {}
		data.meta = { ...clientMeta, ...serverMeta }

		return data
	}
