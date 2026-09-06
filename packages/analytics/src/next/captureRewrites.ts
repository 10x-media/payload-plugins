import type { AnalyticsAdapter } from '../core/contract'

/** One Next.js rewrite entry (the shape `next.config` `rewrites()` returns). */
export interface CaptureRewrite {
	source: string
	destination: string
}

/** An adapter's capture proxy mounted at a base path in the consumer's Next app. */
export interface CaptureRewriteMount {
	/** Base path this adapter's proxy is mounted at, e.g. '/ph' or '/api/analytics/p/global'. */
	path: string
	adapter: AnalyticsAdapter
}

const normalizeMountPath = (path: string): string => {
	const withLeading = path.startsWith('/') ? path : `/${path}`
	const trimmed = withLeading.replace(/\/+$/, '')
	return trimmed === '' ? '/' : trimmed
}

const joinMountPath = (base: string, suffix: string): string =>
	base === '/' ? suffix : `${base}${suffix}`

/**
 * Next.js `rewrites()` entries for every adapter's capture proxy, one mount at a time.
 * Each route's `source`/`upstream` already share `path-to-regexp` param names (e.g.
 * `:p*`), so no translation happens beyond prefixing `source` with the mount's
 * (normalized) path; `upstream` is used verbatim as `destination`.
 *
 * An adapter without `capture` (GA4) or with no proxy routes (the native adapter)
 * contributes nothing rather than throwing, so one broken slot never blanks the rest.
 * Output preserves mount order, then each mount's declared route order.
 *
 * When any mounted adapter's descriptor sets `capture.proxy.trailingSlashes`, add
 * `skipTrailingSlashRedirect: true` to `next.config` (see `posthogProxyRewrites`'s
 * JSDoc for why PostHog needs it).
 */
export const captureRewrites = (mounts: CaptureRewriteMount[]): CaptureRewrite[] => {
	const rewrites: CaptureRewrite[] = []
	for (const mount of mounts) {
		const routes = mount.adapter.capture?.proxy.routes
		if (!routes?.length) {
			continue
		}
		const base = normalizeMountPath(mount.path)
		for (const route of routes) {
			rewrites.push({ source: joinMountPath(base, route.source), destination: route.upstream })
		}
	}
	return rewrites
}
