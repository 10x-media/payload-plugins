export { type AuthScopeProxyOptions, createAuthScopeProxy } from '../scope/next'
export { AUTH_SCOPE_HEADER, resolveAuthScope } from '../scope/resolveAuthScope'
export {
	type ClearStaleSharedCookieOptions,
	isStaleSharedToken,
	withoutCookie,
} from '../scope/staleSharedToken'
export type { AuthScope } from '../types'
