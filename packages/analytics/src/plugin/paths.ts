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
 * Mount of the native ingest endpoint, and the single source of the `ingestPath` the
 * tracker config hands the browser. `native({ ingestPath })` moves the endpoint without
 * moving the tracker config, so an override there needs the tracker pointed at it too.
 */
export const INGEST_PATH = '/analytics/ingest'
