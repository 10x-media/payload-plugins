import type { AnalyticsBinding, BindingContext, BindingDoc } from './types'

const getByPath = (doc: BindingDoc, dotPath: string): unknown =>
	dotPath.split('.').reduce<unknown>((value, key) => {
		if (value && typeof value === 'object') {
			return (value as Record<string, unknown>)[key]
		}
		return undefined
	}, doc)

const nonEmptyString = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0

/**
 * Resolve a document's analytics path. The `path` resolver wins; the `pathField`
 * value is the fallback. Returns null when neither yields a non-empty string (for
 * example an unsaved document with no slug yet).
 */
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
		const value = getByPath(doc, binding.pathField)
		if (nonEmptyString(value)) return value
	}
	return null
}

const CACHE_KEY = '__analyticsPathCache'

/**
 * Resolve the path once per (doc, request): the same `doc` reference is handed to
 * every analytics field on a document, so caching the in-flight Promise on
 * `req.context` collapses an async (possibly ancestor-walking) resolver from once per
 * field to once per document, and shares it across concurrent field renders.
 */
export const resolvePathCached = (
	binding: AnalyticsBinding,
	doc: BindingDoc,
	ctx: BindingContext
): Promise<string | null> => {
	const context = ctx.req.context as Record<string, unknown>
	let cache = context[CACHE_KEY] as WeakMap<BindingDoc, Promise<string | null>> | undefined
	if (!cache) {
		cache = new WeakMap()
		context[CACHE_KEY] = cache
	}
	let cached = cache.get(doc)
	if (!cached) {
		cached = resolvePath(binding, doc, ctx)
		cache.set(doc, cached)
	}
	return cached
}

export const resolveHostname = (binding: AnalyticsBinding, doc: BindingDoc): string | undefined => {
	if (typeof binding.hostname === 'function') return binding.hostname(doc)
	return binding.hostname
}
