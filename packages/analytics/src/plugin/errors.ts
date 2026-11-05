import { isRecord } from '../core/values'

/**
 * Every code an analytics endpoint answers with, so no handler invents one only its client knows.
 * Free of Payload and Node imports: admin clients import {@link readErrorCode} from here.
 */
export const ANALYTICS_ERROR_CODES = [
	'invalid_param',
	'unsupported_metric',
	'unsupported_dimension',
	'unsupported_filter',
	'unsupported_operator',
	'unsupported_granularity',
	'range_too_long',
	'unknown_source',
	'untrusted_scope',
	'not_found',
	'payload_too_large',
	'unauthorized',
	'forbidden',
	'rate_limited',
	'source_misconfigured',
	'unavailable',
	'internal',
] as const

export type AnalyticsErrorCode = (typeof ANALYTICS_ERROR_CODES)[number]

/** Wire shape of a refused request: `param` names the parameter or field at fault. */
export interface AnalyticsError {
	code: AnalyticsErrorCode
	message: string
	param?: string
}

export const analyticsError = (
	code: AnalyticsErrorCode,
	message: string,
	param?: string
): AnalyticsError => ({
	code,
	message,
	...(param === undefined ? {} : { param }),
})

/** Scope depends on the caller's cookies, so no shared cache may ever hold an answer. */
export const NO_STORE = { 'Cache-Control': 'private, no-store' }

/** How long a client should wait out a provider outage before retrying the same read. */
export const RETRY_AFTER = { 'Retry-After': '30' }

/**
 * A `Retry-After` header for a wait in milliseconds, in whole seconds and never below 1; the
 * default 30 seconds when the wait is unknown.
 */
export const retryAfter = (ms: number | undefined): Record<'Retry-After', string> =>
	ms === undefined ? RETRY_AFTER : { 'Retry-After': String(Math.max(1, Math.ceil(ms / 1000))) }

/** An endpoint's error answer: coded body, never cached, headers merged over `NO_STORE`. */
export const errorResponse = (
	status: number,
	error: AnalyticsError,
	headers: Record<string, string> = {}
): Response => Response.json({ error }, { status, headers: { ...NO_STORE, ...headers } })

/** 401 for a request with no signed-in user. */
export const unauthorizedResponse = (): Response =>
	errorResponse(401, analyticsError('unauthorized', 'analytics: authentication required'))

/** 403 for a reader `access.read` turns away. */
export const readDeniedResponse = (): Response =>
	errorResponse(403, analyticsError('forbidden', 'analytics: read access denied'))

/** 503 while no runtime is registered; as retryable as a provider outage, so it waits as long. */
export const notAvailableResponse = (): Response =>
	errorResponse(503, analyticsError('unavailable', 'analytics: not available'), RETRY_AFTER)

/** 400 for a scope the request may not read; `param` names the parameter that carried it. */
export const untrustedScopeResponse = (param?: string): Response =>
	errorResponse(
		400,
		analyticsError('untrusted_scope', 'analytics: scope is not permitted for this request', param)
	)

const CODES: ReadonlySet<string> = new Set<AnalyticsErrorCode>(ANALYTICS_ERROR_CODES)

const isErrorCode = (value: string): value is AnalyticsErrorCode => CODES.has(value)

/**
 * The error in a parsed body, or undefined for a non-envelope body or a code this version never
 * sent, so a newer server's code reads as a generic failure rather than a lie.
 */
export const readError = (body: unknown): AnalyticsError | undefined => {
	if (!isRecord(body)) {
		return undefined
	}
	const error: unknown = body.error
	if (!isRecord(error)) {
		return undefined
	}
	const { code, message, param } = error
	if (typeof code !== 'string' || !isErrorCode(code) || typeof message !== 'string') {
		return undefined
	}
	return analyticsError(code, message, typeof param === 'string' ? param : undefined)
}

/** The code an endpoint answered with, or undefined when the body is not the envelope. */
export const readErrorCode = (body: unknown): AnalyticsErrorCode | undefined =>
	readError(body)?.code

/**
 * {@link readError} over an unread response. A non-JSON or empty body reads as no error rather than
 * throwing, since the status still carries the failure.
 */
export const readResponseError = async (res: Response): Promise<AnalyticsError | undefined> => {
	try {
		return readError(await res.json())
	} catch {
		return undefined
	}
}
