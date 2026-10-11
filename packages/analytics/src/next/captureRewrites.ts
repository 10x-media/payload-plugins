import type { AnalyticsAdapter } from '../core/contract'

/** One Next.js rewrite entry (the shape `next.config` `rewrites()` returns). */
export interface CaptureRewrite {
	source: string
	destination: string
}

/** An adapter's capture proxy mounted at a base path in the consumer's Next app. */
export interface CaptureRewriteMount {
	/** Base path this adapter's proxy is mounted at, e.g. '/ph' or '/api/_x/p/global'. */
	path: string
	adapter: AnalyticsAdapter
}

export const CAPTURE_REWRITES_REMOVED =
	"analytics: captureRewrites no longer returns rewrites: a Next rewrite to a vendor forwards every request header, the visitor's cookies and the site's payload-token among them, and passes the vendor's set-cookie back to the site. Relay the vendor through captureRoute from '@10x-media/analytics/next' in a route handler (app/<mount>/[...path]/route.ts) instead, or leave capture.paths unset to use the plugin's own proxy."

/**
 * @deprecated Throws {@link CAPTURE_REWRITES_REMOVED}: a rewrite to a vendor cannot keep the
 * visitor's cookies from it. Use `captureRoute` in a route handler, or the plugin's own proxy.
 */
export const captureRewrites = (_mounts: CaptureRewriteMount[]): CaptureRewrite[] => {
	throw new Error(CAPTURE_REWRITES_REMOVED)
}
