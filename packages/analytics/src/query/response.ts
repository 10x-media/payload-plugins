import type { SerializedCapabilities } from '../core/capabilities'
import type { AnalyticsQuery, AnalyticsResult } from '../core/contract'
import { isRecord } from '../core/values'
import { hasNoDeclaredGoals } from '../goals/latent'
import type { QueryError } from './errors'

/** Identity of the source a read was served by; its capabilities travel beside it. */
export interface QuerySourceRef {
	id: string
	label: string
	/** `config` for an adapter every scope shares, `runtime` for one resolved per scope. */
	kind: 'config' | 'runtime'
}

/**
 * What each content item a read names is called, keyed by its ref: the document's title as the
 * reader may see it, or `null` for one that is removed, hidden from them or not an item at all.
 */
export type ItemLabels = Record<string, string | null>

/** An `AnalyticsQuery` as it survives JSON: the date range's instants are ISO strings. */
export type SerializedAnalyticsQuery = Omit<AnalyticsQuery, 'dateRange'> & {
	dateRange: { start: string; end: string }
}

/** Successful answer of the query endpoint (`GET <routes.api><routes.base>/query`). */
export interface QueryResponse {
	result: AnalyticsResult
	/**
	 * The equal-length window before `query.dateRange`, asked for with `compare=previous`.
	 * Omitted when the source does not compare or that window is beyond its lookback.
	 */
	comparison?: AnalyticsResult
	/**
	 * ISO 4217 code of the read's revenue: the install's `revenue.currency`, or the code `currency`
	 * is filtered to, counted as sent. Absent means revenue is a plain number.
	 */
	currency?: string
	source: QuerySourceRef
	capabilities: SerializedCapabilities
	/** The query after validation and defaulting, so a client renders what it actually got. */
	query: SerializedAnalyticsQuery
	/**
	 * Slugs in `query.goalSlugs` the install never declared (latent built-in `purchase`); a report
	 * hides such a row until it converts and never counts it as the install having goals.
	 */
	builtinGoalSlugs?: string[]
	/**
	 * Titles for every item ref the read names (in its rows, its filters, or `query.item`), read
	 * with the caller's own access. Absent when it names none.
	 */
	itemLabels?: ItemLabels
}

/**
 * Whether a goal read found no declared goals in scope: an empty table, unlike a source that could
 * not answer (`meta.goalsUnresolved`).
 */
export const askedAboutNoGoals = (
	response?: Pick<QueryResponse, 'builtinGoalSlugs'> & { query?: SerializedAnalyticsQuery }
): boolean => {
	const slugs = response?.query?.goalSlugs
	return Array.isArray(slugs) && hasNoDeclaredGoals(slugs, response?.builtinGoalSlugs)
}

const isResult = (value: unknown): value is AnalyticsResult =>
	isRecord(value) &&
	Array.isArray(value.rows) &&
	value.rows.every((row) => isRecord(row) && isRecord(row.metrics)) &&
	isRecord(value.meta) &&
	typeof value.meta.provider === 'string'

/** The parts of an answer every surface reads before it renders: the rows, their source, the query. */
export const isQueryResponse = (value: unknown): value is QueryResponse =>
	isRecord(value) &&
	isResult(value.result) &&
	(value.comparison === undefined || isResult(value.comparison)) &&
	isRecord(value.source) &&
	typeof value.source.id === 'string' &&
	isRecord(value.capabilities) &&
	isRecord(value.query) &&
	Array.isArray(value.query.metrics)

/** Every non-2xx answer of the query endpoint. */
export interface QueryErrorResponse {
	error: QueryError
}
