import type { SerializedCapabilities } from '../core/capabilities'
import type { AnalyticsQuery, AnalyticsResult } from '../core/contract'
import type { QueryError } from './errors'

/** Identity of the source a read was served by; its capabilities travel beside it. */
export interface QuerySourceRef {
	id: string
	label: string
	/** `config` for an adapter every scope shares, `runtime` for one resolved per scope. */
	kind: 'config' | 'runtime'
}

/** An `AnalyticsQuery` as it survives JSON: the date range's instants are ISO strings. */
export type SerializedAnalyticsQuery = Omit<AnalyticsQuery, 'dateRange'> & {
	dateRange: { start: string; end: string }
}

/** Successful answer of `GET /analytics/query`. */
export interface QueryResponse {
	result: AnalyticsResult
	/**
	 * The equal-length window before `query.dateRange`, asked for with `compare=previous`.
	 * Omitted when the source does not compare or that window is beyond its lookback.
	 */
	comparison?: AnalyticsResult
	source: QuerySourceRef
	capabilities: SerializedCapabilities
	/** The query after validation and defaulting, so a client renders what it actually got. */
	query: SerializedAnalyticsQuery
}

/** Every non-2xx answer of `GET /analytics/query`. */
export interface QueryErrorResponse {
	error: QueryError
}
