import { posthog } from '../adapters/posthog/posthog'
import { captureRewrites } from './captureRewrites'

export type PosthogProxyRegion = 'eu' | 'us'

/** One Next.js rewrite entry (the shape `next.config` `rewrites()` returns). */
export type PosthogProxyRewrite = { source: string; destination: string }

export type PosthogProxyRewritesOptions = {
	/** First-party base path the snippet's `api_host` points at. Default '/ph'. */
	path?: string
	/** PostHog Cloud region. Default 'eu'. */
	region?: PosthogProxyRegion
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
 *
 * @deprecated Use `captureRewrites` with a `posthog()` adapter instance instead: this
 * helper is now a thin wrapper over it, kept only so existing `next.config` files don't
 * break. `captureRewrites` also covers Plausible, Umami, and any adapter that mixes
 * PostHog with another vendor across multiple mount paths.
 */
export const posthogProxyRewrites = (
	options: PosthogProxyRewritesOptions = {}
): PosthogProxyRewrite[] => {
	const region = options.region ?? 'eu'
	const path = options.path ?? '/ph'
	// A token is what makes an adapter declare capture, and only the capture descriptor's
	// routes are read here; the placeholder never reaches a snippet or a browser.
	const adapter = posthog({ projectId: '', apiKey: '', region, projectToken: 'rewrites-only' })
	return captureRewrites([{ path, adapter }])
}
