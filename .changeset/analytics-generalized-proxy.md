---
"@10x-media/analytics": minor
---

Generalize the first-party analytics proxy into a provider-agnostic helper and add a script-snippet helper (`@10x-media/analytics/next`).

`analyticsProxyRewrites(provider, options)` builds Next.js reverse-proxy rewrites for PostHog, Plausible, or Umami, so the browser loads the vendor's real SDK and sends events through your own origin (ad-block resistant, no third-party domains). `posthogProxyRewrites` is unchanged and now backs the PostHog case.

`providerScriptSnippet(options)` builds a provider's client `<script>` markup pointed at the first-party proxy path, so the vendor domain never appears in the browser. Attribute and token values are escaped.

This is the outcome of the tracker/proxy spike (`docs/analytics-tracker-proxy-design.md`): favor proxying to real providers over a homemade capture endpoint, keep the native tracker scoped to the native engine, and defer a runtime multi-tenant proxy handler. GA4 is intentionally not proxyable here.
