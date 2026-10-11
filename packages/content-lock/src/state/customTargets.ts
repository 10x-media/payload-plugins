/** How a custom target's path matches the admin page: the path and below, or exactly it. */
export type PathMatch = 'exact' | 'prefix'

/** A resolved custom target, serializable. */
export type CustomTarget = {
	key: string
	label: string | Record<string, string>
	paths: { path: string; match: PathMatch }[]
}

const normalize = (path: string): string => {
	const trimmed = path.split(/[?#]/)[0]?.replace(/\/+$/, '') ?? ''
	return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Whether `path` (inside the admin, without the admin route) matches. Prefix
 * matches on segment boundaries, so `/reports` covers `/reports/2026` but not
 * `/reportsx`. The query string never counts.
 */
export const pathMatches = (rule: CustomTarget['paths'][number], path: string): boolean => {
	const want = normalize(rule.path)
	const have = normalize(path)
	if (rule.match === 'exact') {
		return have === want
	}
	return want === '/' || have === want || have.startsWith(`${want}/`)
}

/** Keys of the custom targets whose paths match an admin page. */
export const customTargetsAt = (targets: readonly CustomTarget[], path: string): string[] =>
	targets.filter((target) => target.paths.some((rule) => pathMatches(rule, path))).map((t) => t.key)
