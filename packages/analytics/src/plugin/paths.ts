/**
 * Endpoint paths shared between server registration and client fetchers. Kept in a
 * dependency-free leaf module so client components can import the path without
 * pulling server code into the bundle.
 */
export const DOCUMENT_PATH = '/analytics/document'
