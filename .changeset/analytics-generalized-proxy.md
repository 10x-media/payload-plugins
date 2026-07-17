---
"@10x-media/analytics": minor
---

Generalize the first-party analytics proxy into a provider-agnostic helper and add a script-snippet helper (`@10x-media/analytics/next`).

`analyticsProxyRewrites(options)` takes a discriminated `{ provider, ... }` object and builds Next.js reverse-proxy rewrites for PostHog, Plausible, or Umami, so the browser loads the vendor's real SDK and sends events through your own origin (ad-block resistant, no third-party domains). `posthogProxyRewrites` is unchanged and backs the PostHog case. Umami Cloud's script (`cloud.umami.is`) and ingest (`gateway.umami.is`) hosts are proxied to their correct upstreams.

`providerScriptSnippet(options)` builds a provider's client `<script>` markup pointed at the first-party proxy path, so the vendor domain never appears in the browser. It pins Plausible's `data-api` and Umami's `data-host-url` to the proxy path, embeds PostHog's official loader (which self-loads `array.js` through the proxy), and escapes attribute and token values (including `<` to prevent `</script>` breakout).

This is the outcome of the tracker/proxy spike (see the "Client tracking and proxy" docs page): favor proxying to real providers over a homemade capture endpoint, keep the native tracker scoped to the native engine, and defer a runtime multi-tenant proxy handler. GA4 is intentionally not proxyable here.
