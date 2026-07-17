/**
 * Normalize a first-party proxy base path: ensure a single leading slash, drop any
 * trailing slashes, and collapse an empty result to '/'. Shared by the proxy-rewrite
 * and script-snippet helpers so a path cannot be normalized two different ways.
 */
export const normalizePath = (path: string): string => {
	const withLeading = path.startsWith('/') ? path : `/${path}`
	const trimmed = withLeading.replace(/\/+$/, '')
	return trimmed === '' ? '/' : trimmed
}
