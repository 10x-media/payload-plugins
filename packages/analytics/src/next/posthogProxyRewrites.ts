export type PosthogProxyRegion = 'eu' | 'us'

/** One Next.js rewrite entry (the shape `next.config` `rewrites()` returns). */
export type PosthogProxyRewrite = { source: string; destination: string }

export type PosthogProxyRewritesOptions = {
	/** First-party base path the snippet's `api_host` points at. Default '/ph'. */
	path?: string
	/** PostHog Cloud region. Default 'eu'. */
	region?: PosthogProxyRegion
}

const normalizePath = (path: string): string => {
	const withLeading = path.startsWith('/') ? path : `/${path}`
	const trimmed = withLeading.replace(/\/+$/, '')
	return trimmed === '' ? '/' : trimmed
}

/**
 * Next.js rewrites for a first-party PostHog reverse proxy, per PostHog's own
 * guidance: static assets and the array loader route to the region's assets host,
 * everything else to the ingest host. Order matters (Next evaluates rewrites in
 * order), and the app should also set `skipTrailingSlashRedirect: true` because
 * PostHog's capture endpoints use trailing slashes.
 *
 * ```ts
 * // next.config.ts
 * import { posthogProxyRewrites } from '@10x-media/analytics/next'
 *
 * const nextConfig = {
 *   skipTrailingSlashRedirect: true,
 *   async rewrites() {
 *     return posthogProxyRewrites({ path: '/ph', region: 'eu' })
 *   },
 * }
 * ```
 *
 * Point the snippet at it with `api_host: '/ph'` (plus `ui_host` for the region).
 */
export const posthogProxyRewrites = (
	options: PosthogProxyRewritesOptions = {}
): PosthogProxyRewrite[] => {
	const region = options.region ?? 'eu'
	const path = normalizePath(options.path ?? '/ph')
	const assets = `https://${region}-assets.i.posthog.com`
	const ingest = `https://${region}.i.posthog.com`
	return [
		{ source: `${path}/static/:path*`, destination: `${assets}/static/:path*` },
		{ source: `${path}/array/:path*`, destination: `${assets}/array/:path*` },
		{ source: `${path}/:path*`, destination: `${ingest}/:path*` },
	]
}
