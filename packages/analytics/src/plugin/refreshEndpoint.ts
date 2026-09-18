import type { PayloadHandler, PayloadRequest } from 'payload'
import { readCappedBody } from '../capture/requestBody'
import { PLATFORM_SCOPE } from '../core/contract'
import { resolveRequestedScope } from '../core/scopedRead'
import { queryError } from '../query/errors'
import type { RefreshResponse } from '../query/fetchQuery'
import { epochKeyFor, INITIAL_EPOCH } from '../surfacing/epoch'
import { REFRESH_PATH } from './paths'
import { errorResponse, NO_STORE, RETRY_AFTER } from './responses'
import { cacheEpochFor, getRuntime, platformReadGate, readAccessFor } from './runtime'

export { REFRESH_PATH }

/** The body carries one optional scope string; anything larger is not this request. */
export const MAX_REFRESH_BODY_BYTES = 4 * 1024

/**
 * How long one scope stays refreshed after this instance bumps it for a request. This is a
 * debounce of invalidation, not request rate limiting: a looped POST would otherwise retire
 * every cached read of a scope over and over and turn each of them into a provider call. It
 * bounds only what the endpoint does, never how often a caller may ask, which is the edge's
 * job. Collection hooks are not debounced: a save has to be visible on the next read.
 */
export const REFRESH_DEBOUNCE_MS = 5_000

export interface RefreshHandlerOptions {
	/** Clock behind the debounce window; `Date.now` unless a test injects one. */
	now?: () => number
}

export interface RefreshDebounce {
	/** Whether this scope may be bumped now; recording a bump is `record`'s job. */
	allows(key: string): boolean
	/** Marks the scope bumped, dropping every entry the window has already left. */
	record(key: string): void
	/** Entries currently held, which is one window's distinct scopes at most. */
	readonly size: number
}

/**
 * Per-scope debounce state. Entries are pruned on every write rather than kept, so an
 * instance that refreshes thousands of scopes over its life holds only the ones a bump
 * could still be debounced against.
 */
export const createRefreshDebounce = (
	now: () => number,
	windowMs: number = REFRESH_DEBOUNCE_MS
): RefreshDebounce => {
	const bumpedAt = new Map<string, number>()
	return {
		allows(key) {
			const last = bumpedAt.get(key)
			return last === undefined || now() - last >= windowMs
		},
		record(key) {
			const at = now()
			for (const [seen, when] of bumpedAt) {
				if (at - when >= windowMs) {
					bumpedAt.delete(seen)
				}
			}
			bumpedAt.set(key, at)
		},
		get size() {
			return bumpedAt.size
		},
	}
}

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
 * Scope goes through `resolveRequestedScope`, the same decision the query endpoint reads
 * with, so this endpoint refuses every request that endpoint refuses: a named scope needs
 * `platformRead`, and so does a request whose own scope will not resolve on a scoped
 * install. Both answer `400 untrusted_scope`. The wildcard bumps the install-wide token,
 * because a cross-scope read stamps no scope on its query and its entries key on exactly
 * that token.
 */
export const makeRefreshHandler = (opts: RefreshHandlerOptions = {}): PayloadHandler => {
	const now = opts.now ?? Date.now
	const debounce = createRefreshDebounce(now)

	return async (req: PayloadRequest) => {
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
				return read.reason === 'too-large'
					? errorResponse(
							413,
							queryError('payload_too_large', 'analytics: the refresh body is too large')
						)
					: errorResponse(
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
			const requested = await resolveRequestedScope({
				runtime,
				req,
				raw: body.scope ?? null,
				platformRead: platformReadGate(runtime, req),
			})
			if (!requested.ok) {
				return errorResponse(
					400,
					queryError(
						'untrusted_scope',
						'analytics: scope is not permitted for this request',
						'scope'
					)
				)
			}
			const scope = requested.scope === PLATFORM_SCOPE ? null : requested.scope
			const key = epochKeyFor(scope)
			if (!debounce.allows(key)) {
				const debounced: RefreshResponse = { epoch: await cacheEpochFor(runtime, scope) }
				return Response.json(debounced, { headers: NO_STORE })
			}
			const epoch = await (runtime.epoch?.bump(scope) ?? Promise.resolve(INITIAL_EPOCH))
			debounce.record(key)
			const answer: RefreshResponse = { epoch }
			return Response.json(answer, { headers: NO_STORE })
		} catch (err) {
			// A token that cannot be raised leaves the old numbers being served, which is a
			// retry rather than anything the caller can fix.
			req.payload.logger?.warn(`analytics: cache refresh failed: ${String(err)}`)
			return errorResponse(
				503,
				queryError('unavailable', 'analytics: the cache could not be refreshed'),
				RETRY_AFTER
			)
		}
	}
}
