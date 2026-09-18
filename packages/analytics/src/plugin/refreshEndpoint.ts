import type { PayloadHandler, PayloadRequest } from 'payload'
import { readCappedBody } from '../capture/requestBody'
import { PLATFORM_SCOPE } from '../core/contract'
import { queryError } from '../query/errors'
import { REFRESH_PATH } from './paths'
import { errorResponse, NO_STORE, RETRY_AFTER } from './responses'
import { getRuntime, platformReadFor, readAccessFor, resolveScopeFor } from './runtime'

export { REFRESH_PATH }

/** The body carries one optional scope string; anything larger is not this request. */
export const MAX_REFRESH_BODY_BYTES = 4 * 1024

type ParsedBody = { ok: true; scope?: string } | { ok: false }

/**
 * The optional `{ scope }` body. An empty body, a body that is not an object and a body
 * with no `scope` all mean "my own scope": a refresh is a button, and callers that send
 * nothing at all are the common case. Only a `scope` of the wrong type is a refusal.
 */
const parseBody = (bytes: ArrayBuffer): ParsedBody => {
	if (bytes.byteLength === 0) {
		return { ok: true }
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes))
	} catch {
		return { ok: true }
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return { ok: true }
	}
	if (!('scope' in parsed)) {
		return { ok: true }
	}
	const scope: unknown = parsed.scope
	if (scope === undefined || scope === null) {
		return { ok: true }
	}
	return typeof scope === 'string' ? { ok: true, scope } : { ok: false }
}

/**
 * Authenticated POST raising one scope's cache epoch, which retires every cached read
 * keyed on the old one across every instance. Gated exactly like the read endpoints:
 * authentication, then `access.read`, then scope.
 *
 * Scope follows what `/query` does with its `scope` parameter rather than calling
 * `resolveQueryScope`, which decides per adapter and a refresh has none: omitted means the
 * request's own resolved scope, and naming any scope (the platform wildcard included) is
 * the cross-scope decision, so it requires `platformRead` and answers `untrusted_scope`
 * otherwise. The wildcard bumps the install-wide counter, because a cross-scope read
 * stamps no scope on its query and its entries key on exactly that counter.
 */
export const makeRefreshHandler = (): PayloadHandler => async (req: PayloadRequest) => {
	if (!req.user) {
		return errorResponse(401, queryError('unauthorized', 'analytics: authentication required'))
	}
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return errorResponse(503, queryError('unavailable', 'analytics: not available'), RETRY_AFTER)
	}
	try {
		if (!(await readAccessFor(runtime, req))) {
			return errorResponse(403, queryError('forbidden', 'analytics: read access denied'))
		}
		const read = await readCappedBody(req, MAX_REFRESH_BODY_BYTES)
		if (!read.ok) {
			return errorResponse(
				400,
				queryError('invalid_param', 'analytics: the refresh body could not be read', 'scope')
			)
		}
		const body = parseBody(read.body)
		if (!body.ok) {
			return errorResponse(
				400,
				queryError('invalid_param', 'analytics: scope must be a string', 'scope')
			)
		}
		const requested = body.scope
		if (requested !== undefined && !(await platformReadFor(runtime, req))) {
			return errorResponse(
				400,
				queryError('untrusted_scope', 'analytics: scope is not permitted for this request', 'scope')
			)
		}
		const resolved = requested ?? (await resolveScopeFor(runtime, req))
		const scope = resolved === PLATFORM_SCOPE ? null : resolved
		const epoch = await (runtime.epoch?.bump(scope) ?? Promise.resolve(0))
		return Response.json({ epoch }, { headers: NO_STORE })
	} catch (err) {
		// A counter that cannot be raised leaves the old numbers being served, which is a
		// retry rather than anything the caller can fix.
		req.payload.logger?.warn(`analytics: cache refresh failed: ${String(err)}`)
		return errorResponse(
			503,
			queryError('unavailable', 'analytics: the cache could not be refreshed'),
			RETRY_AFTER
		)
	}
}
