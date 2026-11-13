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
			// Per saved version, so a check right after a save asks about the new settings, and a result
			// about the settings before it reads as none.
			const saved = versionOf(readable.updatedAt)
			const version = `${id}@${saved}`
			const stored = async (): Promise<Response> => {
				const answer: ProviderStatusResponse = { status: (await store.read(id, saved)) ?? {} }
				return Response.json(answer, { headers: NO_STORE })
			}
			if (req.method !== 'POST' || !debounce.allows(version)) {
				return stored()
			}
			const collection = req.payload.collections[slug]
			const permissions = collection ? await docAccessOperation({ collection, id, req }) : undefined
			if (!permissions?.update) {
				return errorResponse(
					403,
					analyticsError('forbidden', 'analytics: checking a connection needs update access')
				)
			}
			// No await between this check and `record`, so concurrent checks ask the vendor once.
			if (!debounce.allows(version)) {
				return stored()
			}
			debounce.record(version)
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
			const checked = await checkConnectionOf(req.payload, adapter)
			// A status that could not be saved or read is logged; the check's result is still answered.
			const logged =
				(failed: string) =>
				(err: unknown): undefined => {
					runtime.providerStatusWarning?.(
						`analytics: the connection status of provider document "${id}" could not be ${failed}: ${String(err)}`
					)
					return undefined
				}
			try {
				await store.record(id, checked, { version: saved }).catch(logged('saved'))
			} finally {
				await adapter.close?.(req.payload)
			}
			const status = await store.read(id, saved).catch(logged('read'))
			const answer: ProviderStatusResponse = { status: status ?? {}, checked }
			return Response.json(answer, { headers: NO_STORE })
		} catch (err) {
			req.payload.logger?.error(
				`analytics: the status of provider document "${id}" could not be answered: ${String(err)}`
			)
			return errorResponse(500, analyticsError('internal', 'analytics: provider status failed'))
		}
	}
}
