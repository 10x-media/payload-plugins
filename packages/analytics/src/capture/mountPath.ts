/**
 * One mount path, canonical: a leading slash, no trailing one, `/` for what reduces to
 * the site root. Shared by the Next rewrites helper and the tracker config resolver so a
 * `capture.paths` override and the rewrite it was mounted at cannot disagree over a slash.
 */
export const normalizeMountPath = (path: string): string => {
	const withLeading = path.startsWith('/') ? path : `/${path}`
	const trimmed = withLeading.replace(/\/+$/, '')
	return trimmed === '' ? '/' : trimmed
}
