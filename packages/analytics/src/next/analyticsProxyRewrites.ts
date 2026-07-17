import type { ProviderId } from '../providers/factory'
import { type PosthogProxyRegion, posthogProxyRewrites } from './posthogProxyRewrites'
import { normalizePath } from './utils'

/**
 * Providers whose client SDK and ingest endpoints can be served first-party through a
 * reverse proxy. Derived from the canonical provider list, excluding GA4: Google's
 * collection domains and consent mode make a clean first-party proxy impractical (see
 * the tracker/proxy design doc).
 */
export type ProxyProvider = Exclude<ProviderId, 'ga4'>

/** One Next.js rewrite entry (the shape `next.config` `rewrites()` returns). */
export type AnalyticsProxyRewrite = { source: string; destination: string }

/**
 * Options for one provider's proxy rewrites, discriminated by `provider` so each carries
 * only the fields that provider uses (no silently-ignored `region`/`host`). Mirrors
 * `ProviderScriptOptions` so the two helpers stay symmetric.
 */
export type AnalyticsProxyRewritesOptions =
	| {
			provider: 'posthog'
			/** First-party base path the snippet's `api_host` points at. Default '/ph'. */
			path?: string
			/** PostHog Cloud region. Default 'eu'. */
			region?: PosthogProxyRegion
	  }
	| {
			provider: 'plausible'
			/** First-party base path the snippet points at. Default '/pa'. */
			path?: string
			/** Upstream base URL (no trailing slash). Default cloud; set for self-hosted. */
			host?: string
	  }
	| {
			provider: 'umami'
			/** First-party base path the snippet points at. Default '/um'. */
			path?: string
			/** Upstream base URL (no trailing slash). Default cloud; set for self-hosted. */
			host?: string
	  }

const DEFAULT_PATH: Record<ProxyProvider, string> = {
	posthog: '/ph',
	plausible: '/pa',
	umami: '/um',
}

/**
 * Cloud script/ingest hosts. Plausible serves both from one origin; Umami Cloud serves
 * the tracker from `cloud.umami.is` but collects events at `gateway.umami.is`, so the
 * two must be proxied to different upstreams. A self-hosted `host` overrides both.
 */
const DEFAULT_HOST: Record<
	Exclude<ProxyProvider, 'posthog'>,
	{ script: string; ingest: string }
> = {
	plausible: { script: 'https://plausible.io', ingest: 'https://plausible.io' },
	umami: { script: 'https://cloud.umami.is', ingest: 'https://gateway.umami.is' },
}

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

/**
 * Build Next.js rewrites for a first-party reverse proxy of a supported analytics
 * provider, so the browser loads the vendor's real SDK and sends events through your
 * own origin (ad-block resistant, no third-party domains). Order matters: more specific
 * asset/API routes come before the catch-all. Set `skipTrailingSlashRedirect: true` in
 * `next.config` for PostHog, whose capture endpoints use trailing slashes.
 *
 * Pair with `providerScriptSnippet` for the same `provider` and `path` so the emitted
 * tag's requests match these rewrite sources.
 *
 * ```ts
 * // next.config.ts
 * import { analyticsProxyRewrites } from '@10x-media/analytics/next'
 *
 * const nextConfig = {
 *   skipTrailingSlashRedirect: true,
 *   async rewrites() {
 *     return [
 *       ...analyticsProxyRewrites({ provider: 'posthog', region: 'eu' }),
 *       ...analyticsProxyRewrites({ provider: 'plausible' }),
 *     ]
 *   },
 * }
 * ```
 */
export const analyticsProxyRewrites = (
	options: AnalyticsProxyRewritesOptions
): AnalyticsProxyRewrite[] => {
	const path = normalizePath(options.path ?? DEFAULT_PATH[options.provider])

	if (options.provider === 'posthog') {
		// Delegate to keep a single source of truth for PostHog's asset/ingest split.
		return posthogProxyRewrites({ path, region: options.region })
	}

	const defaults = DEFAULT_HOST[options.provider]
	const script = stripTrailingSlash(options.host ?? defaults.script)
	const ingest = stripTrailingSlash(options.host ?? defaults.ingest)

	if (options.provider === 'plausible') {
		return [
			{ source: `${path}/js/:script*`, destination: `${script}/js/:script*` },
			{ source: `${path}/api/event`, destination: `${ingest}/api/event` },
		]
	}

	return [
		{ source: `${path}/script.js`, destination: `${script}/script.js` },
		{ source: `${path}/api/send`, destination: `${ingest}/api/send` },
	]
}
