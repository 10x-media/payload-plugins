/**
 * Bounds the query endpoint enforces. A leaf module with no imports: the admin view
 * validates a URL against the same numbers without pulling the server-side parser (and
 * its capability and timezone machinery) into the client bundle.
 */

export const MAX_QUERY_METRICS = 10
export const MAX_QUERY_DIMENSIONS = 2
export const MAX_QUERY_FILTERS = 10
export const MIN_QUERY_LIMIT = 1
export const MAX_QUERY_LIMIT = 500
export const DEFAULT_QUERY_LIMIT = 50
export const MAX_QUERY_RANGE_DAYS = 366
export const MAX_QUERY_FILTER_VALUE_LENGTH = 256
export const MAX_QUERY_PATH_LENGTH = 512
export const MAX_QUERY_HOSTNAME_LENGTH = 253
