import { normalizeHostname } from '../native/ingest/requestHost'
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
 * field to once per document, and shares it across concurrent field renders. When the
 * request carries no context bag (incomplete reqs in tests or unusual call sites), it
 * degrades to a direct, un-memoized resolve so the result stays correct.
 */
export const resolvePathCached = (
	binding: AnalyticsBinding,
	doc: BindingDoc,
	ctx: BindingContext
): Promise<string | null> => {
	const context = ctx.req.context as Record<string, unknown> | undefined
	if (!context) {
		return resolvePath(binding, doc, ctx)
	}
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

/**
 * A binding's hostname as the stored events spell it, since a tenant's domain field often
 * carries a scheme, a port or mixed case and the native engine compares hostnames exactly.
 * A value that is no hostname at all is passed through untouched, so a provider that filters
 * on something else keeps whatever the binding gave it.
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

/**
 * Resolve a binding's hostname filter for one document. A function hostname is
 * awaited with the same `(doc, ctx)` a path resolver receives; a nullish or empty
 * result means no hostname filter is applied to the adapter query.
 */
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
