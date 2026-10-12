import type { PayloadRequest } from 'payload'
import type { ReactNode } from 'react'
import { requestScopeToken } from '../../plugin/scopeToken'
import { AnalyticsScopeTokenProvider } from './scopeTokenContext'

/**
 * Mounts the server-resolved scope token at one analytics surface's root for `useRequestScope`.
 * Per surface, never admin-wide, so a stale import map costs only the surface it lacks.
 *
 * @beta
 */
export async function WithScopeToken({
	req,
	children,
}: {
	req: PayloadRequest
	children?: ReactNode
}) {
	const token = await requestScopeToken(req)
	return <AnalyticsScopeTokenProvider token={token}>{children}</AnalyticsScopeTokenProvider>
}
