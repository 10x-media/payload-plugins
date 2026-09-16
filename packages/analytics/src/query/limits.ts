/**
 * Bounds the read and write paths enforce. A leaf module with no imports: the admin view
 * validates a URL against the same numbers without pulling the server-side parser (and
 * its capability and timezone machinery) into the client bundle, and the browser tracker
 * shares the wire caps with ingest without pulling the ingest pipeline into its own.
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

/**
 * Ingest wire caps, not read-path bounds. `MAX_QUERY_LENGTH` is the page's own query string
 * (the one utm keys are read out of), which the tracker caps before it sends and ingest caps
 * again because the endpoint is public; `MAX_REFERRER_LENGTH` bounds the stored referrer.
 */
export const MAX_QUERY_LENGTH = 512
export const MAX_REFERRER_LENGTH = 512

/**
 * Caps each geo value (country, region, city). They arrive from a resolver reading
 * request headers, which a client can set, and they end up as rollup dimvalues and
 * seen-ledger keys: uncapped, one oversized header pushes a Postgres btree key past its
 * 2704-byte limit and fails the write, while Mongo accepts it, so the two databases would
 * disagree about whether the hit counted.
 */
export const MAX_GEO_LENGTH = 128
