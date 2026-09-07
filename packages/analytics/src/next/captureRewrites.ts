import { normalizeMountPath } from '../capture/mountPath'
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

const assertNotRoot = (path: string): void => {
	if (path === '/') {
		throw new Error('captureRewrites: mount path must not be the site root')
	}
}

// One base is a prefix of another when they're equal or the longer one continues past a
// '/' boundary, so '/ph' collides with '/ph' and '/ph/x' but not the mere string-prefix
// sibling '/phx'.
const isPrefixOrEqual = (a: string, b: string): boolean => a === b || b.startsWith(`${a}/`)

const assertNoCollisions = (paths: string[]): void => {
	for (let i = 0; i < paths.length; i++) {
		for (let j = i + 1; j < paths.length; j++) {
			const a = paths[i] as string
			const b = paths[j] as string
			if (isPrefixOrEqual(a, b) || isPrefixOrEqual(b, a)) {
				throw new Error(`captureRewrites: mount paths collide: '${a}' and '${b}'`)
			}
		}
	}
}

/**
 * Next.js `rewrites()` entries for every adapter's capture proxy, one mount at a time.
 * Each route's `source`/`upstream` already share `path-to-regexp` param names (e.g.
 * `:p*`), so no translation happens beyond prefixing `source` with the mount's
 * (normalized) path; `upstream` is used verbatim as `destination`. Next always strips a
 * trailing slash from the matched path before substituting it into `destination` (unlike
 * the runtime proxy, which can be told to keep one via `trailingSlashes`); harmless for
 * every vendor this helper supports today.
 *
 * An adapter without `capture` (GA4) or with no proxy routes (the native adapter)
 * contributes nothing rather than throwing, so one broken slot never blanks the rest.
 * Output preserves mount order, then each mount's declared route order.
 *
 * Throws for a mount path that normalizes to the site root (an unprefixed catch-all
 * route would swallow the whole app) or for two mounts whose normalized paths are equal
 * or nested (Next matches rewrites first-match-wins, so an earlier catch-all would
 * silently shadow a later mount's routes). Distinct sibling paths that merely share a
 * string prefix, e.g. `/ph` and `/phx`, are unaffected.
 *
 * When any mounted adapter's descriptor sets `capture.proxy.trailingSlashes`, add
 * `skipTrailingSlashRedirect: true` to `next.config` (see `posthogProxyRewrites`'s
 * JSDoc for why PostHog needs it).
 */
export const captureRewrites = (mounts: CaptureRewriteMount[]): CaptureRewrite[] => {
	const normalized = mounts.map((mount) => normalizeMountPath(mount.path))
	for (const path of normalized) {
		assertNotRoot(path)
	}
	assertNoCollisions(normalized)

	const rewrites: CaptureRewrite[] = []
	for (let i = 0; i < mounts.length; i++) {
		const mount = mounts[i] as CaptureRewriteMount
		const routes = mount.adapter.capture?.proxy.routes
		if (!routes?.length) {
			continue
		}
		const base = normalized[i] as string
		for (const route of routes) {
			rewrites.push({ source: `${base}${route.source}`, destination: route.upstream })
		}
	}
	return rewrites
}
