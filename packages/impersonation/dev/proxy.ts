import { createAuthScopeProxy } from '@10x-media/dual-session/proxy'

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts`. Required so a partner session
 * (isolated cookie) and an admin session can coexist on the frontend without
 * the isolated cookie winning `/admin`.
 */
export default createAuthScopeProxy()

export const config = {
	matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
