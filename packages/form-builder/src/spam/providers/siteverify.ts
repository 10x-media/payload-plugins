import type { PayloadRequest } from 'payload'
import { firstHop } from '../clientIp'

/** The response shape shared by the Turnstile, reCAPTCHA, and hCaptcha siteverify endpoints. */
export type SiteverifyResult = {
	success?: boolean
	score?: number
	'error-codes'?: string[]
}

export const DEFAULT_SITEVERIFY_TIMEOUT = 5_000

export type SiteverifyParamsArgs = {
	secretKey: string
	/** Header read for the client IP forwarded as `remoteip`. Default 'x-forwarded-for'. */
	ipHeader?: string
}

/** Form params for a siteverify POST: secret + response, plus `remoteip` when the IP header resolves. */
export const siteverifyParams = (
	args: SiteverifyParamsArgs,
	token: string,
	req: PayloadRequest
): URLSearchParams => {
	const params = new URLSearchParams({ secret: args.secretKey, response: token })
	const remoteip = firstHop(req.headers, args.ipHeader ?? 'x-forwarded-for')
	if (remoteip) {
		params.set('remoteip', remoteip)
	}
	return params
}

/**
 * POST a form-encoded siteverify request. Network errors, timeouts, and non-2xx responses all
 * resolve to null so adapters fail closed instead of throwing into the submission path.
 */
export const postSiteverify = async (
	url: string,
	params: URLSearchParams,
	timeoutMs: number
): Promise<SiteverifyResult | null> => {
	try {
		const res = await fetch(url, {
			method: 'POST',
			body: params,
			signal: AbortSignal.timeout(timeoutMs),
		})
		if (!res.ok) {
			return null
		}
		return (await res.json()) as SiteverifyResult
	} catch {
		return null
	}
}
