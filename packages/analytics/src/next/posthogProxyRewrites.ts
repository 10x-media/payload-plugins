import { CAPTURE_REWRITES_REMOVED } from './captureRewrites'

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
 * @deprecated Throws, as `captureRewrites` does: a rewrite to PostHog forwards the visitor's cookies
 * and the site's credentials. Relay PostHog through `captureRoute` with a `posthog()` adapter.
 */
export const posthogProxyRewrites = (
	_options: PosthogProxyRewritesOptions = {}
): PosthogProxyRewrite[] => {
	throw new Error(CAPTURE_REWRITES_REMOVED)
}
