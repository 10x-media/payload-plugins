/**
 * Endpoint paths shared between server registration and client fetchers. Kept in a
 * dependency-free leaf module so client components can import the path without
 * pulling server code into the bundle.
 */
export const DOCUMENT_PATH = '/analytics/document'
export const SOURCES_PATH = '/analytics/sources'
export const REALTIME_PATH = '/analytics/realtime'
/** Mount of the public capture proxy; each slot is served under `${PROXY_PATH}/<slot>`. */
export const PROXY_PATH = '/analytics/p'
/** Public tracker config, per-request scope. */
export const TRACKER_PATH = '/analytics/tracker'
/**
 * Default mount of the native ingest endpoint, and the fallback for the `ingestPath` the
 * tracker config hands the browser. `native({ ingestPath })` moves both: the adapter
 * declares the override through `ingest.path`, which the runtime lifts onto the config.
 */
export const INGEST_PATH = '/analytics/ingest'
