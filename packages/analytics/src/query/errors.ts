/**
 * The query endpoint's whole error vocabulary. The parameter parser raises only the
 * `400` codes; the handler raises the rest: `unauthorized` (`401`), `forbidden` (`403`,
 * `access.read` or a cross-scope read the caller may not make), `unknown_source`
 * (`404`), `untrusted_scope` (`400`), `payload_too_large` (`413`, the refresh endpoint's
 * body cap), `unavailable` (`503`) and `internal` (`500`).
 */
export type QueryErrorCode =
	| 'invalid_param'
	| 'unsupported_metric'
	| 'unsupported_dimension'
	| 'unsupported_filter'
	| 'unsupported_operator'
	| 'unsupported_granularity'
	| 'range_too_long'
	| 'unknown_source'
	| 'untrusted_scope'
	| 'payload_too_large'
	| 'unauthorized'
	| 'forbidden'
	| 'unavailable'
	| 'internal'

/** Wire shape of a rejected read: `param` names the query parameter at fault. */
export interface QueryError {
	code: QueryErrorCode
	message: string
	param?: string
}

export const queryError = (code: QueryErrorCode, message: string, param?: string): QueryError => ({
	code,
	message,
	...(param === undefined ? {} : { param }),
})
