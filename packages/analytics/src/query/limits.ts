/**
 * Leaf module with no imports, so the admin view and browser tracker share these bounds without
 * pulling the server parser or ingest pipeline into their bundles.
 */

export const MAX_QUERY_METRICS = 10
export const MAX_QUERY_DIMENSIONS = 2
export const MAX_QUERY_FILTERS = 10
export const MIN_QUERY_LIMIT = 1
export const MAX_QUERY_LIMIT = 500
export const DEFAULT_QUERY_LIMIT = 50
export const MAX_QUERY_RANGE_DAYS = 366

/** Whether a window is longer than {@link MAX_QUERY_RANGE_DAYS}, which every read path refuses. */
export const exceedsRangeCap = (range: { start: Date; end: Date }): boolean =>
	range.end.getTime() - range.start.getTime() > MAX_QUERY_RANGE_DAYS * 86_400_000

/** The earliest year a bound may name: nothing was counted before 1970. */
export const MIN_QUERY_YEAR = 1970

export const MAX_SCOPE_LENGTH = 256
export const MAX_QUERY_FILTER_VALUE_LENGTH = 256
export const MAX_QUERY_PATH_LENGTH = 512
export const MAX_QUERY_HOSTNAME_LENGTH = 253

/**
 * Ingest wire caps, not read-path bounds. `MAX_QUERY_LENGTH` is the page's own query string (utm
 * source), capped by the tracker and again by public ingest.
 */
export const MAX_QUERY_LENGTH = 512
export const MAX_REFERRER_LENGTH = 512

/**
 * Caps each geo value: it comes from client-settable headers and keys daily totals, where an
 * oversized one fails Postgres's 2704-byte btree limit but passes Mongo.
 */
export const MAX_GEO_LENGTH = 128
