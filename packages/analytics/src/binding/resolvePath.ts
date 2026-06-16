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
export const resolvePath = (
	binding: AnalyticsBinding,
	doc: BindingDoc,
	ctx: BindingContext
): string | null => {
	if (binding.path) {
		const resolved = binding.path(doc, ctx)
		if (nonEmptyString(resolved)) return resolved
	}
	if (binding.pathField) {
		const value = getByPath(doc, binding.pathField)
		if (nonEmptyString(value)) return value
	}
	return null
}

export const resolveHostname = (binding: AnalyticsBinding, doc: BindingDoc): string | undefined => {
	if (typeof binding.hostname === 'function') return binding.hostname(doc)
	return binding.hostname
}
