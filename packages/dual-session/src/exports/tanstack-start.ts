export { AUTH_SCOPE_HEADER, resolveAuthScope } from '../scope/resolveAuthScope'
export {
	type ClearStaleSharedCookieOptions,
	isStaleSharedToken,
	withoutCookie,
} from '../scope/staleSharedToken'
export { type AuthScopeMiddlewareOptions, createAuthScopeMiddleware } from '../scope/tanstackStart'
export type { AuthScope } from '../types'
