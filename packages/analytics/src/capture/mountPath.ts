/**
 * One mount path, canonical: leading slash, no trailing one, `/` for the root. Shared so a
 * `capture.paths` override and the `captureRoute` mounted there cannot disagree over a slash.
 */
export const normalizeMountPath = (path: string): string => {
	const withLeading = path.startsWith('/') ? path : `/${path}`
	const trimmed = withLeading.replace(/\/+$/, '')
	return trimmed === '' ? '/' : trimmed
}
