import type { PosthogProxyRegion } from './posthogProxyRewrites'

/**
 * Options for one provider's client script, pointed at a first-party proxy `path`
 * (see `analyticsProxyRewrites`). Discriminated by `provider` so each carries only the
 * identifiers that vendor's snippet needs.
 */
export type ProviderScriptOptions =
	| {
			provider: 'posthog'
			/** PostHog project API key (`phc_...`). */
			token: string
			/** First-party proxy base path. Default '/ph'. */
			path?: string
			/** PostHog Cloud region, used for `ui_host`. Default 'eu'. */
			region?: PosthogProxyRegion
	  }
	| {
			provider: 'plausible'
			/** The site domain registered in Plausible. */
			domain: string
			/** First-party proxy base path. Default '/pa'. */
			path?: string
	  }
	| {
			provider: 'umami'
			/** Umami website id. */
			websiteId: string
			/** First-party proxy base path. Default '/um'. */
			path?: string
	  }

const normalizePath = (path: string): string => {
	const withLeading = path.startsWith('/') ? path : `/${path}`
	const trimmed = withLeading.replace(/\/+$/, '')
	return trimmed === '' ? '/' : trimmed
}

const escapeAttr = (value: string): string =>
	value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const escapeJs = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/**
 * Build a provider's real client `<script>` markup pointed at a first-party proxy path,
 * so the vendor domain never appears in the browser. Pair with `analyticsProxyRewrites`
 * for the matching `path`. Returns an HTML string the consumer injects into their
 * frontend (this collects on the public site, not the Payload admin).
 */
export const providerScriptSnippet = (options: ProviderScriptOptions): string => {
	if (options.provider === 'plausible') {
		const path = normalizePath(options.path ?? '/pa')
		return `<script defer data-domain="${escapeAttr(options.domain)}" src="${path}/js/script.js"></script>`
	}

	if (options.provider === 'umami') {
		const path = normalizePath(options.path ?? '/um')
		return `<script defer src="${path}/script.js" data-website-id="${escapeAttr(options.websiteId)}"></script>`
	}

	const path = normalizePath(options.path ?? '/ph')
	const region = options.region ?? 'eu'
	const uiHost = `https://${region}.posthog.com`
	// PostHog's array loader is served through the proxy; api_host and ui_host keep the
	// browser talking only to the first-party origin for capture.
	return `<script>
!function(){var e=window.posthog=window.posthog||[];e.init=e.init||function(){};}();
window.posthog.init('${escapeJs(options.token)}',{api_host:'${path}',ui_host:'${uiHost}',defaults:'2025-05-24'});
</script>
<script async src="${path}/static/array.js"></script>`
}
