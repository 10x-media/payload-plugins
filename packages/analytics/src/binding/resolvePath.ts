import { valueAt } from '../core/values'
import { normalizeHostname } from '../native/ingest/requestHost'
import type { AnalyticsBinding, BindingContext, BindingDoc } from './types'

const nonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0

/** A document's tracked pathname: `path` first, then `pathField`; null when neither names one. */
export const resolvePath = async (
	binding: AnalyticsBinding,
	doc: BindingDoc,
	ctx: BindingContext
): Promise<string | null> => {
	if (binding.path) {
		const resolved = await binding.path(doc, ctx)
		if (nonEmptyString(resolved)) return resolved
	}
	if (binding.pathField) {
		const value = valueAt(doc, binding.pathField)
		if (nonEmptyString(value)) return value
	}
	return null
}

const CACHE_KEY = '__analyticsPathCache'

type PathCache = WeakMap<BindingDoc, Promise<string | null>>

const pathCacheOf = (context: Record<string, unknown>): PathCache => {
	const existing = context[CACHE_KEY]
	if (existing instanceof WeakMap) {
		return existing
	}
	const created: PathCache = new WeakMap()
	context[CACHE_KEY] = created
	return created
}

/**
 * Memoizes the in-flight resolve per document per request on `req.context`, since every analytics
 * field on a document shares one `doc`; a request without context resolves directly.
 */
export const resolvePathCached = (
	binding: AnalyticsBinding,
	doc: BindingDoc,
	ctx: BindingContext
): Promise<string | null> => {
	const context: Record<string, unknown> | undefined = ctx.req.context
	if (!context) {
		return resolvePath(binding, doc, ctx)
	}
	const cache = pathCacheOf(context)
	let cached = cache.get(doc)
	if (!cached) {
		cached = resolvePath(binding, doc, ctx)
		cache.set(doc, cached)
	}
	return cached
}

/**
 * Normalized as stored events spell it, since a domain field often carries a scheme, port or mixed
 * case and the native engine compares exactly. A non-hostname passes through untouched.
 */
export const hostnameFromBinding = (raw: string): string => {
	let candidate = raw
	if (raw.includes('://')) {
		try {
			candidate = new URL(raw).host
		} catch {
			return raw
		}
	}
	return normalizeHostname(candidate) ?? raw
}

/** The hostname a binding names for a document, normalized; undefined when it names none. */
export const resolveHostname = async (
	binding: AnalyticsBinding,
	doc: BindingDoc,
	ctx: BindingContext
): Promise<string | undefined> => {
	if (typeof binding.hostname === 'function') {
		const resolved = await binding.hostname(doc, ctx)
		return nonEmptyString(resolved) ? hostnameFromBinding(resolved) : undefined
	}
	return binding.hostname === undefined ? undefined : hostnameFromBinding(binding.hostname)
}
