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
