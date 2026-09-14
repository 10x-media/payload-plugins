/**
 * Error codes the query endpoint answers `400` with. `unknown_source` (`404`) and
 * `untrusted_scope` (`400`) are raised by the handler, not by the parameter parser.
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
