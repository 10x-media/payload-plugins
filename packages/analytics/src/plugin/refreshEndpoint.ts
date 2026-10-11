import type { PayloadHandler, PayloadRequest } from 'payload'
import { readGate } from '../access/readGate'
import { readCappedBody } from '../capture/requestBody'
import { isCollectionSlug } from '../core/collectionSlug'
import { monotonicMs } from '../core/monotonic'
import { resolveRequestedScope } from '../core/scopedRead'
import { resolveScopeList } from '../core/scopeList'
import { isRecord } from '../core/values'
import type { RefreshResponse } from '../query/fetchQuery'
import { epochKeyFor, INITIAL_EPOCH } from '../surfacing/epoch'
import {
	analyticsError,
	errorResponse,
	NO_STORE,
	notAvailableResponse,
	RETRY_AFTER,
	readDeniedResponse,
	unauthorizedResponse,
	untrustedScopeResponse,
} from './errors'
import {
	type AnalyticsRuntime,
	cacheEpochFor,
	getRuntime,
	resolvableScope,
	scopeGates,
} from './runtime'

/** The body carries one optional scope string; anything larger is not this request. */
export const MAX_REFRESH_BODY_BYTES = 4 * 1024

/**
 * Per-scope invalidation debounce, so a looped POST cannot turn every cached read into a provider
 * call; rate limiting is the edge's job. Hooks skip it, since a save must show on the next read.
 */
export const REFRESH_DEBOUNCE_MS = 5_000

interface RefreshHandlerOptions {
	/** Clock behind the debounce window; `monotonicMs` unless a test injects one. */
	now?: () => number
}

interface RefreshDebounce {
	/** Whether this scope may be bumped now; recording a bump is `record`'s job. */
	allows(key: string): boolean
	/** Marks the scope bumped, dropping every entry the window has already left. */
	record(key: string): void
	/** Entries currently held, which is one window's distinct scopes at most. */
	readonly size: number
}

/**
 * Per-scope debounce state, pruned on every write so a long-lived instance holds only scopes a bump
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

/**
 * Whether a named scope has anything to refresh: in `scope.list`, else owning a cached read,
 * provider or epoch. With no list or cache collection to ask, every name passes.
 */
const knownScope = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest,
	scope: string
): Promise<boolean> => {
	if (runtime.scopeList) {
		return (await resolveScopeList(runtime.scopeList, req.payload)).includes(scope)
	}
	const cacheSlug = runtime.cacheCollectionSlug
	if (cacheSlug === undefined || !isCollectionSlug(req.payload, cacheSlug)) {
		return true
	}
	const owned = (collection: string, field: string) =>
		isCollectionSlug(req.payload, collection)
			? req.payload.db.findOne({ collection, where: { [field]: { equals: scope } }, req })
			: Promise.resolve(null)
	const providers = runtime.providersCollection
	const [cached, provider, epoch] = await Promise.all([
		owned(cacheSlug, 'owner'),
		providers ? owned(providers.slug, providers.scopeField) : Promise.resolve(null),
		req.payload.kv.get(epochKeyFor(scope)),
	])
	return cached !== null || provider !== null || epoch !== null
}

type ParsedBody = { ok: true; scope?: string } | { ok: false }

/**
 * The optional `{ scope }` body. Empty, non-object and scope-less bodies mean the caller's own
 * scope, the common button case; only a wrongly typed `scope` is refused.
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
	const scope = isRecord(parsed) ? parsed.scope : undefined
	if (scope === undefined || scope === null) {
		return { ok: true }
	}
	return typeof scope === 'string' ? { ok: true, scope } : { ok: false }
}

interface RefreshTarget {
	/** The scope whose epoch to raise, null for the install-wide one. */
	scope: string | null
	/** The body named the scope rather than leaving it to the request's own. */
	named: boolean
}

/** The scope a refresh may raise, or the refusal that answers instead. */
const refreshTargetOf = async (
	runtime: AnalyticsRuntime,
	req: PayloadRequest
): Promise<RefreshTarget | Response> => {
	if (!(await readGate(runtime, req))) {
		return readDeniedResponse()
	}
	const read = await readCappedBody(req, MAX_REFRESH_BODY_BYTES)
	if (!read.ok) {
		return read.reason === 'too-large'
			? errorResponse(
					413,
					analyticsError('payload_too_large', 'analytics: the refresh body is too large')
				)
			: errorResponse(
					400,
					analyticsError('invalid_param', 'analytics: the refresh body could not be read', 'scope')
				)
	}
	const body = parseBody(read.body)
	if (!body.ok) {
		return errorResponse(
			400,
			analyticsError('invalid_param', 'analytics: scope must be a string', 'scope')
		)
	}
	const requested = await resolveRequestedScope({
		runtime,
		req,
		raw: body.scope ?? null,
		gates: scopeGates(runtime, req),
	})
	if (!requested.ok) {
		return untrustedScopeResponse('scope')
	}
	return {
		scope: resolvableScope(requested.scope),
		named: body.scope !== undefined,
	}
}

/**
 * Authenticated POST raising one scope's cache epoch, retiring its cached reads on every instance.
 * Gated like the query endpoint; the wildcard bumps the install-wide token cross-scope reads use.
 */
export const makeRefreshHandler = (opts: RefreshHandlerOptions = {}): PayloadHandler => {
	const now = opts.now ?? monotonicMs
	const debounce = createRefreshDebounce(now)

	return async (req: PayloadRequest) => {
		if (!req.user) {
			return unauthorizedResponse()
		}
		const runtime = getRuntime(req.payload)
		if (!runtime) {
			return notAvailableResponse()
		}
		let target: RefreshTarget | Response
		try {
			target = await refreshTargetOf(runtime, req)
		} catch (err) {
			// A throwing `access.read` or scope resolver is a config bug, which a retry repeats.
			req.payload.logger?.error(`analytics: refresh request failed: ${String(err)}`)
			return errorResponse(500, analyticsError('internal', 'analytics: refresh failed'))
		}
		if (target instanceof Response) {
			return target
		}
		const { scope, named } = target
		try {
			// A name nothing belongs to has nothing cached to retire, and must not leave a row behind.
			if (named && scope !== null && !(await knownScope(runtime, req, scope))) {
				const untouched: RefreshResponse = { epoch: INITIAL_EPOCH }
				return Response.json(untouched, { headers: NO_STORE })
			}
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
				analyticsError('unavailable', 'analytics: the cache could not be refreshed'),
				RETRY_AFTER
			)
		}
	}
}
