/**
 * Every code any analytics endpoint answers with, in one place so a handler cannot invent
 * a word only its own client knows. Kept free of Payload and Node imports: admin clients
 * import {@link readErrorCode} from here to branch on what an endpoint said.
 *
 * `invalid_param` and the `unsupported_*` family are the query parser's `400`s;
 * `unauthorized` (`401`), `forbidden` (`403`), `not_found` (`404`), `unknown_source`
 * (`404`), `untrusted_scope` (`400`), `payload_too_large` (`413`), `unavailable` (`503`)
 * and `internal` (`500`) are raised by the handlers themselves.
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

/** An endpoint's error answer: coded body, never cached, headers merged over `NO_STORE`. */
export const errorResponse = (
	status: number,
	error: AnalyticsError,
	headers: Record<string, string> = {}
): Response => Response.json({ error }, { status, headers: { ...NO_STORE, ...headers } })

const CODES: ReadonlySet<string> = new Set<AnalyticsErrorCode>(ANALYTICS_ERROR_CODES)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

const isErrorCode = (value: string): value is AnalyticsErrorCode => CODES.has(value)

/**
 * The error out of a parsed response body, or undefined for anything this version cannot
 * read: a body that is not the envelope, and a code no release of this package ever sent.
 * A code added by a newer server therefore reads as a generic failure rather than as a lie.
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
 * {@link readError} over a response whose body has yet to be read. A body that is not JSON
 * at all, including an empty one, reads as no error rather than throwing: the status still
 * carries the failure.
 */
export const readResponseError = async (res: Response): Promise<AnalyticsError | undefined> => {
	try {
		return readError(await res.json())
	} catch {
		return undefined
	}
}
