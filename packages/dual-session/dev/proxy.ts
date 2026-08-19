import { createAuthScopeProxy } from '@10x-media/dual-session/proxy'

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`; the file must sit next to `app/`,
 * which for this dev app is the package's `dev/` root.
 */
export default createAuthScopeProxy()

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
