/**
 * Path pattern matching for the undo history's ignore list.
 *
 * Form-state paths are dot separated and carry a numeric segment for every
 * array or blocks row (`list.0.nested.1.value`), so a pattern language needs
 * exactly one wildcard: `*`, matching a single segment. That covers "this field
 * in every row" (`list.*.rowRich`) without needing a second, greedier wildcard,
 * because a pattern that runs out before the path does matches the whole
 * subtree below it.
 *
 * Subtree semantics are the point, not a side effect: ignoring an array by name
 * (`list`) has to ignore its rows too, otherwise the rows keep producing history
 * entries for a field the host asked to be left alone.
 */

const WILDCARD = '*'

/**
 * True when `pattern` matches `path` exactly or matches one of its ancestors.
 *
 * `list.*.title` matches `list.0.title` but not `list.0.meta.title`: a `*`
 * stands for one segment, never several.
 */
export const matchesPattern = (path: string, pattern: string): boolean =>
	matchesSegments(path.split('.'), pattern.split('.'))

const matchesSegments = (pathSegments: string[], patternSegments: string[]): boolean => {
	// A longer pattern cannot match: it would have to consume segments the path
	// does not have. An equal or shorter one matches the path or an ancestor.
	if (patternSegments.length > pathSegments.length) return false
	return patternSegments.every((segment, i) => segment === WILDCARD || segment === pathSegments[i])
}

/** Tests a path against a fixed pattern set. */
export type PathMatcher = (path: string) => boolean

/**
 * Build a matcher over `patterns`.
 *
 * Patterns are split once up front and verdicts are memoized per path, because
 * this runs over every path in the form state on every capture, and the set of
 * paths a document produces is bounded by its schema rather than by session
 * length. An empty pattern set short-circuits to a constant `false`.
 */
export const createPathMatcher = (patterns: Iterable<string>): PathMatcher => {
	const compiled = [...new Set(patterns)]
		.filter((pattern) => pattern.length > 0)
		.map((pattern) => pattern.split('.'))
	if (compiled.length === 0) return () => false

	const memo = new Map<string, boolean>()
	return (path: string): boolean => {
		const cached = memo.get(path)
		if (cached !== undefined) return cached
		const segments = path.split('.')
		const result = compiled.some((pattern) => matchesSegments(segments, pattern))
		memo.set(path, result)
		return result
	}
}
