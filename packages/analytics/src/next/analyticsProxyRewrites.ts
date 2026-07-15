import { type PosthogProxyRegion, posthogProxyRewrites } from './posthogProxyRewrites'

/**
 * Providers whose client SDK and ingest endpoints can be served first-party through a
 * reverse proxy. GA4 is intentionally excluded: Google's collection domains and consent
 * mode make a clean first-party proxy impractical (see the tracker/proxy design doc).
 */
export type ProxyProvider = 'posthog' | 'plausible' | 'umami'

/** One Next.js rewrite entry (the shape `next.config` `rewrites()` returns). */
export type AnalyticsProxyRewrite = { source: string; destination: string }

export interface AnalyticsProxyRewritesOptions {
	/** First-party base path the provider snippet points at. Provider-specific default. */
	path?: string
	/** PostHog Cloud region. Ignored by other providers. Default 'eu'. */
	region?: PosthogProxyRegion
	/**
	 * Upstream base URL for Plausible / Umami (no trailing slash). Defaults to each
	 * vendor's cloud host; set it to your self-hosted instance URL.
	 */
	host?: string
}

const DEFAULT_PATH: Record<ProxyProvider, string> = {
	posthog: '/ph',
	plausible: '/pa',
	umami: '/um',
}

const DEFAULT_HOST: Record<Exclude<ProxyProvider, 'posthog'>, string> = {
	plausible: 'https://plausible.io',
	umami: 'https://cloud.umami.is',
}

const normalizePath = (path: string): string => {
	const withLeading = path.startsWith('/') ? path : `/${path}`
	const trimmed = withLeading.replace(/\/+$/, '')
	return trimmed === '' ? '/' : trimmed
}

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

/**
 * Build Next.js rewrites for a first-party reverse proxy of a supported analytics
 * provider, so the browser loads the vendor's real SDK and sends events through your
 * own origin (ad-block resistant, no third-party domains). Order matters: more specific
 * asset/API routes come before the catch-all. Set `skipTrailingSlashRedirect: true` in
 * `next.config` for PostHog, whose capture endpoints use trailing slashes.
 *
 * ```ts
 * // next.config.ts
 * import { analyticsProxyRewrites } from '@10x-media/analytics/next'
 *
 * const nextConfig = {
 *   skipTrailingSlashRedirect: true,
 *   async rewrites() {
 *     return [
 *       ...analyticsProxyRewrites('posthog', { region: 'eu' }),
 *       ...analyticsProxyRewrites('plausible', { host: 'https://plausible.io' }),
 *     ]
 *   },
 * }
 * ```
 */
export const analyticsProxyRewrites = (
	provider: ProxyProvider,
	options: AnalyticsProxyRewritesOptions = {}
): AnalyticsProxyRewrite[] => {
	const path = normalizePath(options.path ?? DEFAULT_PATH[provider])

	if (provider === 'posthog') {
		// Delegate to keep a single source of truth for PostHog's asset/ingest split.
		return posthogProxyRewrites({ path, region: options.region })
	}

	const host = stripTrailingSlash(options.host ?? DEFAULT_HOST[provider])

	if (provider === 'plausible') {
		return [
			{ source: `${path}/js/:script*`, destination: `${host}/js/:script*` },
			{ source: `${path}/api/event`, destination: `${host}/api/event` },
		]
	}

	// umami
	return [
		{ source: `${path}/script.js`, destination: `${host}/script.js` },
		{ source: `${path}/api/send`, destination: `${host}/api/send` },
	]
}
