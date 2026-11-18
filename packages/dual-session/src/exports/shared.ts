/**
 * Helpers with no server dependency: the auth scope header and the isolated cookie names, for
 * host code on either side. The root is the server plugin.
 */
export { getIsolatedCookieName } from '../auth/cookies'
export { AUTH_SCOPE_HEADER } from '../scope/resolveAuthScope'
export type { AuthScope } from '../types'
