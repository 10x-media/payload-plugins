import { createAuthScopeMiddleware } from '@10x-media/dual-session/tanstack-start'
import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

/**
 * Stamps every request with its auth scope, the TanStack Start counterpart of the Next dev app's
 * `dev/proxy.ts`. A global `requestMiddleware` list replaces TanStack Start's default CSRF
 * middleware, so that one is listed again with its default filter: unfiltered it would also
 * refuse every REST call and page request that carries no origin headers.
 */
export const startInstance = createStart(() => ({
	requestMiddleware: [
		createCsrfMiddleware({ filter: ({ handlerType }) => handlerType === 'serverFn' }),
		createAuthScopeMiddleware(),
	],
}))
