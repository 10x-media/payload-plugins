import { docAccessOperation, type PayloadHandler, type PayloadRequest } from 'payload'
import { isCollectionSlug } from '../core/collectionSlug'
import type { AnalyticsAdapter } from '../core/contract'
import { monotonicMs } from '../core/monotonic'
import type { ConnectionOutcome, ProviderStatusResponse } from '../providers/connectionState'
import { classifyError } from '../surfacing/classifyError'
import {
	analyticsError,
	errorResponse,
	NO_STORE,
	notAvailableResponse,
	unauthorizedResponse,
} from './errors'
import { createRefreshDebounce } from './refreshEndpoint'
import { getRuntime } from './runtime'

/** How long a Test connection waits for the vendor before it counts as unreachable. */
export const CONNECTION_CHECK_TIMEOUT_MS = 10_000

/** A second check of one document this soon answers the first one's result, asking nothing. */
export const CONNECTION_CHECK_DEBOUNCE_MS = 5_000

interface ProviderStatusHandlerOptions {
	/** Clock behind the debounce window; `monotonicMs` unless a test injects one. */
	now?: () => number
}

const notFound = (): Response =>
	errorResponse(404, analyticsError('not_found', 'analytics: no such provider document', 'id'))

/**
 * What a check's failure says about the connection: a vendor refusing the cheapest read it has is
 * set up wrong whatever its status code, so only an outage stays `unavailable`.
 */
const checkFailureOf = (err: unknown): ConnectionOutcome => {
	const failure = classifyError(err)
	return {
		ok: false,
		kind: failure.kind === 'unavailable' ? 'unavailable' : 'source_misconfigured',
		...(!failure.hostRefused && err instanceof Error ? { detail: err.message } : {}),
	}
}

/** What the document's check found; an incomplete document is refused without asking the vendor. */
const runCheck = async (
	req: PayloadRequest,
	adapter: AnalyticsAdapter
): Promise<ConnectionOutcome> => {
	if (!adapter.isConfigured()) {
		return { ok: false, kind: 'source_misconfigured' }
	}
	try {
		await adapter.checkConnection?.({
			signal: AbortSignal.timeout(CONNECTION_CHECK_TIMEOUT_MS),
			timeoutMs: CONNECTION_CHECK_TIMEOUT_MS,
			payload: req.payload,
		})
		return { ok: true }
	} catch (err) {
		return checkFailureOf(err)
	}
}

/**
 * GET answers one provider document's last connection result, POST checks the connection first.
 * Both take the document as `?id=`: a GET needs read access to it, a POST update access, each
 * asked of Payload with the caller's own user, so a tenant reaches only its own documents.
 */
export const makeProviderStatusHandler = (
	opts: ProviderStatusHandlerOptions = {}
): PayloadHandler => {
	const debounce = createRefreshDebounce(opts.now ?? monotonicMs, CONNECTION_CHECK_DEBOUNCE_MS)

	return async (req: PayloadRequest) => {
		if (!req.user) {
			return unauthorizedResponse()
		}
		const runtime = getRuntime(req.payload)
		const slug = runtime?.providersCollection?.slug
		const store = runtime?.providerStatus
		if (!runtime || !store || slug === undefined || !isCollectionSlug(req.payload, slug)) {
			return notAvailableResponse()
		}
		const id = new URL(req.url ?? '', 'http://localhost').searchParams.get('id')?.trim()
		if (!id) {
			return errorResponse(
				400,
				analyticsError('invalid_param', 'analytics: id names the provider document', 'id')
			)
		}
		try {
			const readable = await req.payload.findByID({
				collection: slug,
				id,
				depth: 0,
				disableErrors: true,
				overrideAccess: false,
				user: req.user,
				req,
			})
			if (!readable) {
				return notFound()
			}
			if (req.method !== 'POST' || !debounce.allows(id)) {
				const answer: ProviderStatusResponse = { status: (await store.read(id)) ?? {} }
				return Response.json(answer, { headers: NO_STORE })
			}
			const collection = req.payload.collections[slug]
			const permissions = collection ? await docAccessOperation({ collection, id, req }) : undefined
			if (!permissions?.update) {
				return errorResponse(
					403,
					analyticsError('forbidden', 'analytics: checking a connection needs update access')
				)
			}
			const adapter = await runtime.providerAdapter?.(id)
			if (!adapter?.checkConnection) {
				return errorResponse(
					400,
					analyticsError(
						'invalid_param',
						'analytics: this provider has no connection to check',
						'id'
					)
				)
			}
			debounce.record(id)
			const checked = await runCheck(req, adapter)
			try {
				await store.record(id, checked)
			} finally {
				await adapter.close?.(req.payload)
			}
			const answer: ProviderStatusResponse = { status: (await store.read(id)) ?? {}, checked }
			return Response.json(answer, { headers: NO_STORE })
		} catch (err) {
			req.payload.logger?.error(
				`analytics: the status of provider document "${id}" could not be answered: ${String(err)}`
			)
			return errorResponse(500, analyticsError('internal', 'analytics: provider status failed'))
		}
	}
}
