import { createHmac } from 'node:crypto'
import type { PayloadRequest } from 'payload'
import { requestMemo } from './requestMemo'
import { getRuntime, resolveScopeFor } from './runtime'

/** Stands in for a scope the host's resolver could not answer, which is a scope of its own. */
const UNRESOLVED = '\u0000unresolved'

const tokens = requestMemo<string | undefined>('scopeToken')

const tokenKey = (secret: string): Buffer =>
	createHmac('sha256', secret).update('@10x-media/analytics:request-scope').digest()

/**
 * Opaque HMAC of user and `scope.resolve` answer for admin reads, computed server-side so a tenant
 * in an HttpOnly cookie or proxy header still changes it. Never throws.
 */
export const requestScopeToken = async (req: PayloadRequest): Promise<string | undefined> => {
	const runtime = getRuntime(req.payload)
	const { user } = req
	if (!runtime || !user) {
		return undefined
	}
	return tokens(req, {
		owner: runtime,
		key: 'token',
		compute: async () => {
			const scope = runtime.resolveScope
				? await resolveScopeFor(runtime, req).catch(() => UNRESOLVED)
				: null
			return createHmac('sha256', tokenKey(req.payload.secret))
				.update(JSON.stringify([String(user.collection), String(user.id), scope]))
				.digest('base64url')
		},
	}).catch(() => undefined)
}
