import { DEFAULT_HONEYPOT_FIELD } from './constants'
import { defaultIdentify } from './identify'
import { createKvRateLimiter } from './rateLimiter'
import type {
	RateLimitConfig,
	ResolvedRateLimit,
	ResolvedSpamConfig,
	SpamConfig,
	SpamOption,
} from './types'

const DEFAULT_WINDOW = 60_000
const DEFAULT_SUBMISSION_MAX = 5
const DEFAULT_UPLOAD_MAX = 20

const resolveRateLimit = (
	option: false | RateLimitConfig | undefined,
	defaultMax: number
): false | ResolvedRateLimit => {
	if (option === false) {
		return false
	}
	const cfg = option ?? {}
	return {
		window: cfg.window ?? DEFAULT_WINDOW,
		max: cfg.max ?? defaultMax,
		limiter: cfg.limiter ?? createKvRateLimiter(),
	}
}

/**
 * Resolve the `spam` plugin option into a concrete config. `false` disables the whole subsystem.
 * Otherwise honeypot + both rate limits default on, captcha + metadata capture default off, and the
 * identity seam defaults to user id / trusted IP header.
 */
export const resolveSpamConfig = (option: SpamOption | undefined): ResolvedSpamConfig | false => {
	if (option === false) {
		return false
	}
	const cfg: SpamConfig = option ?? {}
	const ipHeader = cfg.ipHeader ?? 'x-forwarded-for'
	return {
		honeypot:
			cfg.honeypot === false
				? false
				: { fieldName: cfg.honeypot?.fieldName ?? DEFAULT_HONEYPOT_FIELD },
		rateLimit: resolveRateLimit(cfg.rateLimit, DEFAULT_SUBMISSION_MAX),
		uploadRateLimit: resolveRateLimit(cfg.uploadRateLimit, DEFAULT_UPLOAD_MAX),
		captcha: cfg.captcha,
		identify: cfg.identify ?? defaultIdentify(ipHeader),
		ipHeader,
		metadata: { ip: cfg.metadata?.ip ?? false, ua: cfg.metadata?.ua ?? false },
		uploadOwnership: cfg.uploadOwnership ?? 'lenient',
	}
}
