import type { Payload, PayloadRequest } from 'payload'
import { customStateOf, stashCustomState } from '../plugin/customState'
import type { ConsentSourceEntry, ConsentSourcesResolver } from './types'

type ConsentCustomState = { consentSources: ConsentSourcesResolver }

/** Park the host's resolver on the config so root-level helpers can find it via `payload.config`. */
export const stashConsentSources = (
	custom: Record<string, unknown> | undefined,
	sources: ConsentSourcesResolver
): Record<string, unknown> =>
	stashCustomState<ConsentCustomState>(custom, { consentSources: sources })

export const consentSourcesOf = (payload: Payload): ConsentSourcesResolver | undefined =>
	customStateOf<ConsentCustomState>(payload).consentSources

const CACHE_KEY = 'formBuilderConsentSourcesCache'

type EntriesCache = Map<string, ConsentSourceEntry[]>

const cacheOf = (req: PayloadRequest): EntriesCache | undefined => {
	if (!req.context) {
		return undefined
	}
	const existing = req.context[CACHE_KEY]
	if (existing instanceof Map) {
		return existing as EntriesCache
	}
	const created: EntriesCache = new Map()
	req.context[CACHE_KEY] = created
	return created
}

export type ResolveConsentEntriesArgs = {
	payload: Payload
	req: PayloadRequest
	/** The form whose consent fields are being resolved; handed to the resolver for per-form scoping. */
	form: { id: number | string; title?: string | null }
	/** Resolver override for plugin-internal callers; defaults to the one the plugin stashed on the config. */
	sources?: ConsentSourcesResolver
}

/**
 * The host's consent sources for this request, or an empty list when no resolver is configured
 * (in which case the `consent` field type is not registered either, so nothing can reference one).
 * Throws whatever the resolver throws: every caller decides how to fail, and none of them fail open.
 * Cached per request and form id, so one submission resolves the host's sources once no matter how
 * many consent fields the form carries.
 */
export const resolveConsentEntries = async (
	args: ResolveConsentEntriesArgs
): Promise<ConsentSourceEntry[]> => {
	const { payload, req, form } = args
	const resolver = args.sources ?? consentSourcesOf(payload)
	if (!resolver) {
		return []
	}
	const cache = cacheOf(req)
	const cacheKey = String(form.id)
	const cached = cache?.get(cacheKey)
	if (cached) {
		return cached
	}
	const entries = await resolver({
		req,
		form: { id: form.id, title: typeof form.title === 'string' ? form.title : undefined },
	})
	cache?.set(cacheKey, entries)
	return entries
}
