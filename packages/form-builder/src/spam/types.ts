import type { PayloadRequest } from 'payload'

/** Stable identity key for a request, or null/undefined when the client cannot be identified (rate-limiting then skips: fail-open). */
export type IdentifyFn = (
	req: PayloadRequest
) => null | string | undefined | Promise<null | string | undefined>

export type RateLimitResult = {
	ok: boolean
	/** Remaining requests in the current window (>= 0). */
	remaining: number
	/** Epoch ms when the current window resets. */
	resetAt: number
}

export type RateLimitCheckArgs = {
	key: string
	/** Max requests per window. */
	max: number
	/** Window length in ms. */
	window: number
	req: PayloadRequest
}

/** Pluggable limiter. The default is a window counter over `payload.kv`; swap for Redis/etc. */
export type RateLimiter = {
	check(args: RateLimitCheckArgs): Promise<RateLimitResult>
}

export type CaptchaVerifyArgs = {
	token: string
	req: PayloadRequest
}

/** A captcha adapter. Use a bundled provider (Turnstile/reCAPTCHA/hCaptcha) or build one with `defineCaptchaProvider`. */
export type CaptchaProvider = {
	type: string
	verify(args: CaptchaVerifyArgs): Promise<boolean>
}

export type RateLimitConfig = {
	/** Window length in ms. Default 60000. */
	window?: number
	/** Max creates per identity per window. */
	max?: number
	/** Override the limiter (default: KV window counter). */
	limiter?: RateLimiter
}

export type SpamMetadataConfig = {
	/** Persist the client IP (from the trusted header) onto the submission `meta`. Default false (privacy). */
	ip?: boolean
	/** Persist the user-agent onto the submission `meta`. Default false. */
	ua?: boolean
}

export type SpamConfig = {
	/** Honeypot decoy. Default on. `false` disables. */
	honeypot?: false | { fieldName?: string }
	/** Per-identity rate limit on submission create. Default on (60s window, max 5). `false` disables. */
	rateLimit?: false | RateLimitConfig
	/** Per-identity rate limit on upload create. Default on (60s window, max 20). `false` disables. */
	uploadRateLimit?: false | RateLimitConfig
	/** A captcha provider (none by default): `turnstileProvider`/`recaptchaProvider`/`hcaptchaProvider` or a custom adapter. */
	captcha?: CaptchaProvider
	/** Identity resolution for rate-limiting, upload ownership, and (future) poll dedup. Default: user id, else trusted IP header. */
	identify?: IdentifyFn
	/** Header read for the client IP (proxy-dependent, best-effort). Default 'x-forwarded-for'. */
	ipHeader?: string
	/** Opt-in capture of client metadata onto the submission `meta`. Off by default. */
	metadata?: SpamMetadataConfig
}

/** `false` disables the whole subsystem; an object configures it (all controls default on except captcha + metadata). */
export type SpamOption = false | SpamConfig

export type ResolvedRateLimit = { window: number; max: number; limiter: RateLimiter }

export type ResolvedSpamConfig = {
	honeypot: false | { fieldName: string }
	rateLimit: false | ResolvedRateLimit
	uploadRateLimit: false | ResolvedRateLimit
	captcha?: CaptchaProvider
	identify: IdentifyFn
	ipHeader: string
	metadata: { ip: boolean; ua: boolean }
}
