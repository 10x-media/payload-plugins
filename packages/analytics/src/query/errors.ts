import type { AnalyticsError, AnalyticsErrorCode } from '../plugin/errors'

export { analyticsError as queryError } from '../plugin/errors'

/** Alias of {@link AnalyticsErrorCode}, kept for consumers that imported this name. */
export type QueryErrorCode = AnalyticsErrorCode

/** Alias of {@link AnalyticsError}, kept for consumers that imported this name. */
export type QueryError = AnalyticsError
