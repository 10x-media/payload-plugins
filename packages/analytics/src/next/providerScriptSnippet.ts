import type { PosthogProxyRegion } from './posthogProxyRewrites'
import { normalizePath } from './utils'

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

const escapeAttr = (value: string): string =>
	value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

// Escapes a value for a single-quoted JS string inside an inline <script>. The `<`
// escape is what prevents a crafted value containing `</script>` from terminating the
// element at the HTML parser level (\x3C is the standard defense).
const escapeJs = (value: string): string =>
	value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3C')

/**
 * Build a provider's real client `<script>` markup pointed at a first-party proxy path,
 * so the vendor domain never appears in the browser. Pair with `analyticsProxyRewrites`
 * for the same provider and `path`. Returns an HTML string the consumer injects into
 * their frontend (this collects on the public site, not the Payload admin).
 *
 * The string form runs only in server-rendered initial HTML and cannot carry a CSP
 * nonce; for CSP or client-navigation-aware loading, wrap the vendor SDK in a client
 * component with `next/script` instead.
 */
export const providerScriptSnippet = (options: ProviderScriptOptions): string => {
	if (options.provider === 'plausible') {
		const path = normalizePath(options.path ?? '/pa')
		// data-api pins the event endpoint to the proxy; without it Plausible derives it
		// from the script origin ("/api/event" at the site root), which the proxy misses.
		return `<script defer data-domain="${escapeAttr(options.domain)}" data-api="${path}/api/event" src="${path}/js/script.js"></script>`
	}

	if (options.provider === 'umami') {
		const path = normalizePath(options.path ?? '/um')
		// data-host-url routes collection through the proxy; the cloud tracker otherwise
		// posts straight to gateway.umami.is, defeating the first-party proxy.
		return `<script defer src="${path}/script.js" data-website-id="${escapeAttr(options.websiteId)}" data-host-url="${path}"></script>`
	}

	const path = normalizePath(options.path ?? '/ph')
	const region = options.region ?? 'eu'
	const uiHost = `https://${region}.posthog.com`
	// PostHog's official loader snippet: it queues the init call in `posthog._i` and
	// self-loads array.js from `api_host + /static/array.js` (here, the proxy path), so no
	// separate script tag is needed. `ui_host` keeps toolbar/replay links on the real app.
	return `<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('${escapeJs(options.token)}',{api_host:'${path}',ui_host:'${uiHost}',defaults:'2026-05-30'});
</script>`
}
