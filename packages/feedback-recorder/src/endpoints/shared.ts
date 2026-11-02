import {
	addDataAndFileToRequest,
	headersWithCors,
	type PayloadRequest,
	type TypedUser,
} from 'payload'

import { getRegistry } from '../plugin/registry'
import type { TenxResult } from '../server/tenx'
import type { ResolvedOptions } from '../types'

const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = ({
	body,
	req,
	status,
}: {
	body: unknown
	req: PayloadRequest
	status: number
}): Response =>
	Response.json(body, { headers: headersWithCors({ headers: new Headers(NO_STORE), req }), status })

export type Allowed = { options: ResolvedOptions; user: TypedUser }

/**
 * Same-origin only for anything that reaches the 10x system with this site's key. A browser marks
 * a cross-site request in `Sec-Fetch-Site`; one without the header (a server, curl) still needs a
 * session, which is what the rest of the guard checks.
 */
const isCrossSite = (headers: Headers): boolean => {
	const site = headers.get('Sec-Fetch-Site')
	return site === 'cross-site' || site === 'same-site'
}

/**
 * Who may use the endpoints: a signed-in user the `access` option allows, on a site that has a
 * 10x connection configured. Answers with the refusal, or with the options and the user.
 */
export const allow = async (req: PayloadRequest): Promise<Allowed | Response> => {
	const options = getRegistry(req.payload.config)
	if (!options) return json({ body: { error: 'notRegistered' }, req, status: 500 })
	if (isCrossSite(req.headers)) return json({ body: { error: 'origin' }, req, status: 403 })
	const user = req.user
	if (!user) return json({ body: { error: 'unauthorized' }, req, status: 401 })
	if (!(await options.access({ payload: req.payload, user }))) {
		return json({ body: { error: 'forbidden' }, req, status: 403 })
	}
	if (!options.configured) return json({ body: { error: 'notConfigured' }, req, status: 503 })
	return { options, user }
}

export const readJson = async (req: PayloadRequest): Promise<Record<string, unknown>> => {
	await addDataAndFileToRequest(req)
	const data = req.data
	return data && typeof data === 'object' && !Array.isArray(data)
		? (data as Record<string, unknown>)
		: {}
}

/** Clip ids go into a URL path on the 10x side, so only id-shaped strings pass. */
export const clipIdFrom = (req: PayloadRequest): string | null => {
	const id = req.routeParams?.id
	return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

/** Hands a 10x answer back to the browser, keeping only an error message from a refusal. */
export const relay = (req: PayloadRequest, result: TenxResult): Response => {
	if (result.ok) return json({ body: result.body, req, status: result.status })
	const message =
		result.body && typeof result.body === 'object' && 'error' in result.body
			? String((result.body as { error: unknown }).error)
			: undefined
	return json({ body: { error: result.error, message }, req, status: result.status })
}
