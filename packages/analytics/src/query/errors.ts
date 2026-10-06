import type { AnalyticsError, AnalyticsErrorCode } from '../plugin/errors'

export { analyticsError as queryError } from '../plugin/errors'

/**
 * The query endpoint's vocabulary, which is the whole plugin's since every endpoint
 * answers in one envelope. Kept under its old name so consumers importing it still
 * compile; new code reads {@link AnalyticsErrorCode}.
 */
export type QueryErrorCode = AnalyticsErrorCode

/** Alias of {@link AnalyticsError}, kept for consumers that imported this name. */
export type QueryError = AnalyticsError
