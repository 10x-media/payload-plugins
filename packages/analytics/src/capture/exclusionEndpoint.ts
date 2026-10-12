import type { PayloadHandler, PayloadRequest } from 'payload'
import { readGate } from '../access/readGate'
import { PLATFORM_SCOPE } from '../core/contract'
import { resolveRequestedScope } from '../core/scopedRead'
import { resolveScopeList } from '../core/scopeList'
import { siteAddress } from '../core/siteAddress'
import { analyticsError, errorResponse, NO_STORE } from '../plugin/errors'
import {
	type AnalyticsRuntime,
	getRuntime,
	resolveCaptureScopeFor,
	scopeGates,
} from '../plugin/runtime'
import type { ExclusionResponse, ExclusionSite } from '../view/exclusionLink'
import { exclusionToken } from './exclusionToken'

const viewAllowed = async (runtime: AnalyticsRuntime, req: PayloadRequest): Promise<boolean> =>
	runtime.viewAccess ? runtime.viewAccess({ req }) : true

/**
 * Whether the admin's own address resolves to `scope` as a visit would. Null on an unscoped
 * install, whose site may run at this address or on a separate frontend.
 */
const servesScope = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<boolean | null> => {
	if (runtime.scoped !== true) {
		return null
	}
	if (scope === null) {
		return false
	}
	try {
		return (await resolveCaptureScopeFor(runtime, req)) === scope
	} catch {
		return false
	}
}

/**
 * The scope's site addresses from `capture.exclusion.sites`, trimmed to origin and path. A throwing
 * resolver costs the whole links, never the token: the view hands out the part to add instead.
 */
const sitesOf = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<string[]> => {
	const resolve = runtime.exclusion?.sites
	if (!resolve) {
		return []
	}
	let answered: unknown
	try {
		answered = await resolve({ req, scope })
	} catch (err) {
		req.payload.logger?.warn(`analytics: capture.exclusion.sites failed: ${String(err)}`)
		return []
	}
	const sites = (Array.isArray(answered) ? answered : []).flatMap((site: unknown) => {
		const address = siteAddress(site)
		return address === null ? [] : [address]
	})
	return [...new Set(sites)]
}

const siteEntries = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string | null
): Promise<ExclusionSite[]> => {
	const token = exclusionToken(req.payload.secret, scope)
	return (await sitesOf(runtime, req, scope)).map((address) => ({ address, token }))
}

/** The install-wide sites, then each listed scope's, each with its own token; an address once. */
const everyScopeSites = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest
): Promise<ExclusionSite[]> => {
	const scopes = await resolveScopeList(runtime.scopeList, req.payload)
	const lists = await Promise.all(scopes.map((scope) => siteEntries(runtime, req, scope)))
	const byAddress = new Map<string, ExclusionSite>()
	for (const site of lists.flat()) {
		if (!byAddress.has(site.address)) {
			byAddress.set(site.address, site)
		}
	}
	return [...byAddress.values()]
}

/**
 * A scope's exclusion token and sites, gated like a read plus `access.view` (all sites: every
 * scope's, for a reader who may name each). Never cached: a token drops a browser from numbers.
 */
export const makeExclusionHandler = (): PayloadHandler => async (req) => {
	if (!req.user) {
		return errorResponse(401, analyticsError('unauthorized', 'analytics: authentication required'))
	}
	const runtime = getRuntime(req.payload)
	if (!runtime?.exclusion) {
		return errorResponse(404, analyticsError('not_found', 'analytics: the exclusion link is off'))
	}
	try {
		if (!(await readGate(runtime, req)) || !(await viewAllowed(runtime, req))) {
			return errorResponse(403, analyticsError('forbidden', 'analytics: read access denied'))
		}
		const raw = new URL(req.url ?? '', 'http://localhost').searchParams.get('scope')
		const gates = scopeGates(runtime, req)
		const requested = await resolveRequestedScope({ runtime, req, raw, gates })
		if (!requested.ok) {
			return errorResponse(
				400,
				analyticsError(
					'untrusted_scope',
					'analytics: scope is not permitted for this request',
					'scope'
				)
			)
		}
		if (requested.scope === PLATFORM_SCOPE) {
			return errorResponse(
				400,
				analyticsError(
					'invalid_param',
					'analytics: an exclusion link belongs to one site, so name one scope or none',
					'scope'
				)
			)
		}
		// A scoped install's null passed the aggregate gate; another scope's token also takes `named`.
		const everyScope = runtime.scoped === true && requested.scope === null && (await gates.named())
		const answer: ExclusionResponse = {
			param: runtime.exclusion.param,
			token: exclusionToken(req.payload.secret, requested.scope),
			sameOrigin: await servesScope(runtime, req, requested.scope),
			sites: everyScope
				? await everyScopeSites(runtime, req)
				: await siteEntries(runtime, req, requested.scope),
		}
		return Response.json(answer, { headers: NO_STORE })
	} catch (err) {
		req.payload.logger?.warn(`analytics: exclusion link failed: ${String(err)}`)
		return errorResponse(
			500,
			analyticsError('internal', 'analytics: the exclusion link could not be made')
		)
	}
}
