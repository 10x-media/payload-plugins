import { docAccessOperation, type PayloadHandler, type PayloadRequest } from 'payload'
import { isCollectionSlug } from '../core/collectionSlug'
import { monotonicMs } from '../core/monotonic'
import { isRecord } from '../core/values'
import { checkConnectionOf } from '../providers/connectionCheck'
import type { ProviderStatusResponse } from '../providers/connectionState'
import { versionOf } from '../providers/probe'
import {
	analyticsError,
	errorResponse,
	NO_STORE,
	notAvailableResponse,
	unauthorizedResponse,
} from './errors'
import { createRefreshDebounce } from './refreshEndpoint'
import { getRuntime } from './runtime'

/** A second check of one saved document this soon answers the first one's result, asking nothing. */
const CONNECTION_CHECK_DEBOUNCE_MS = 5_000

interface ProviderStatusHandlerOptions {
	/** Clock behind the debounce window; `monotonicMs` unless a test injects one. */
	now?: () => number
}

const notFound = (): Response =>
	errorResponse(404, analyticsError('not_found', 'analytics: no such provider document', 'id'))

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
			const readable: unknown = await req.payload.findByID({
				collection: slug,
				id,
				depth: 0,
				disableErrors: true,
				overrideAccess: false,
				user: req.user,
				req,
			})
			if (!isRecord(readable)) {
				return notFound()
			}
			// Per saved version, so a check right after a save asks about the new settings.
			const version = `${id}@${versionOf(readable.updatedAt)}`
			if (req.method !== 'POST' || !debounce.allows(version)) {
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
			debounce.record(version)
			const checked = await checkConnectionOf(req.payload, adapter)
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
