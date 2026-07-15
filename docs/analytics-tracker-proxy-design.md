# Analytics: client tracking and proxy strategy (spike)

Status: exploration for review. This is a dedicated design PR to decide how `@10x-media/analytics` should support client-side data collection. It ships a small proof-of-concept (a generalized first-party proxy helper and a provider script-snippet helper) and documents the caveats, blockers, and the recommended direction. Nothing here changes existing behavior.

## Problem

The plugin surfaces analytics (widgets, display fields, reads) but ships nothing to collect it on the browser. The native engine exposes a `POST /analytics/ingest` endpoint, but there is no bundled client tracker that calls it, and external providers (GA4, Plausible, PostHog, Umami) are expected to be wired up by the consumer with each vendor's own snippet.

Two things we want:

1. A first-class way to collect client-side events without every consumer hand-rolling it.
2. Ideally one first-party tracking surface, so browsers do not load vendor domains directly (ad-block resistance, privacy, fewer third-party requests).

Two things we are wary of:

1. A homemade universal capture endpoint means a database write and rollup work on our own server for every single event. That is exactly where a busy site hits performance, scaling, and correctness problems. Forwarding to a real provider (the current PostHog reverse-proxy pattern) is cheap and offloads all of that.
2. A homemade tracker cannot offer full feature parity with any given provider. If the tracker silently supports less than the provider's own SDK (no autocapture, no session replay, no consent integration, no funnels), that is confusing and a downgrade.

## Options considered

### A. Native client tracker to `/analytics/ingest`

A small script that posts pageviews/events to the native ingest endpoint (via `navigator.sendBeacon`), which normalizes and writes rollups. Batching already exists (`WriteBuffer` / `flushBatch`).

- Pros: fully first-party, fully controlled, no vendor domains, works offline of any SaaS.
- Cons: only feeds the native engine (not GA4/PostHog/etc); every event is DB + rollup work on our server; feature set is whatever we build (no autocapture, replay, funnels). Scales on our database, not a vendor's ingestion pipeline.
- Verdict: keep it, but scope it honestly as the "native engine only" option, using the existing write buffer to avoid per-event write storms. It is not a multi-provider parity solution.

### B. Generalized first-party reverse proxy

Generalize the existing `posthogProxyRewrites` into a provider-agnostic first-party proxy. The browser loads the provider's own script and sends events through our origin (e.g. `/ph`, `/pa`, `/um`); the provider does all aggregation.

- Pros: cheap and scalable (the vendor ingests and aggregates); full provider feature parity (it is the vendor's real SDK); ad-block resistant (first-party origin); this is the pattern our PostHog setups already use.
- Cons: build-time static rewrites only fit a single provider/region per path (fine for the common single-tenant case). Multi-tenant or multi-provider-per-request needs a runtime handler that resolves the provider config per hostname/scope and forwards accordingly.
- Verdict: this is the right default. Ship the build-time generalization now; propose the runtime handler as a follow-up (below).

### C. Unified hidden loader (one script, multiple providers)

One first-party script that, per resolved scope/hostname, loads the configured provider bundle(s) through the proxy so browsers never see GA4/Plausible/PostHog domains.

- Reality check: "one script that speaks every vendor's capture protocol" is not realistic to build or maintain (each SDK has its own wire format, cookies, consent model, and evolves independently). The realistic form of C is a thin loader that injects the resolved provider's real SDK through the proxy path. That is option B plus a loader, not a new protocol.
- Verdict: pursue as B (proxy) + D (script injection), not as a bespoke universal capture endpoint.

### D. Manually provided scripts in plugin config

The consumer supplies a script URL or snippet per provider/scope; the plugin injects it (optionally rewritten to go through the proxy so the vendor domain stays hidden).

- Pros: simplest, no protocol reimplementation, maximally flexible; pairs naturally with B.
- Cons: the consumer owns the snippet content; the plugin only helps wire it first-party.
- Verdict: ship a small snippet-builder helper; this is the pragmatic realization of "one hidden tracking script."

## Provider proxy support matrix

| Provider | First-party proxy | Notes / blockers |
|---|---|---|
| PostHog | Supported (shipped) | `posthogProxyRewrites`; vendor documents the reverse proxy pattern. |
| Plausible | Supported | Vendor documents proxying the script and the `/api/event` endpoint. |
| Umami | Supported | Self-host / proxy friendly; script and `/api/send` can be first-party. |
| GA4 (gtag) | Poor / not recommended | Google endpoints, consent mode, and multiple collection domains make a clean first-party proxy impractical. Use Google's server-side tagging if first-party GA is required. |

## Cost model (why proxy over ingest)

- Proxy (B): our server does an HTTP forward (cheap, stateless, cacheable at the edge). The vendor absorbs ingestion, dedup, sessionization, and aggregation. This is how the current PostHog setups scale.
- Native ingest (A): our server does, per event, geo resolution, hashing, and one-or-more rollup upserts plus a seen-ledger check for uniques. The write buffer coalesces bursts, but sustained high-traffic sites push load onto our database. Fine for small/medium native installs; not the default for high volume.

## Recommendation

1. Do not build a homemade universal capture protocol. It loses provider features and moves heavy work onto our server (the two things we are explicitly wary of).
2. Default to the first-party proxy (B). Ship the generalized build-time helper now (`analyticsProxyRewrites`). Propose a runtime proxy handler as a follow-up for multi-tenant / multi-provider-per-request resolution.
3. Pair it with a script-injection helper (D): a snippet-builder that emits a provider's real SDK tag pointed at the first-party proxy path, so the vendor domain stays hidden. This is the realistic form of "one hidden tracking script."
4. Keep the native tracker (A) as a clearly-scoped native-engine-only option, using the existing `WriteBuffer`. Document that it does not feed external providers and does not match a vendor SDK's feature set.

## Proof of concept in this PR

- `analyticsProxyRewrites(provider, options)`: generalizes `posthogProxyRewrites` to PostHog, Plausible, and Umami first-party reverse-proxy rewrites (build-time, for `next.config` `rewrites()`). `posthogProxyRewrites` stays as a thin back-compatible wrapper.
- `providerScriptSnippet(provider, options)`: builds the provider's real `<script>` tag string pointed at the first-party proxy `path`, so the consumer can inject one hidden tag per configured provider.

Both are pure, tested, side-effect-free helpers. They demonstrate the proxy-not-ingest direction without committing to the runtime handler.

## Proposed follow-up (not in this PR)

A runtime proxy handler (a Payload endpoint or Next route handler) that:

1. Resolves the request's scope/hostname to a provider config (reusing `scopeResolver` and the providers collection/resolver).
2. Forwards script and ingest requests to the resolved upstream(s).
3. Optionally fans out to multiple providers for one install.

Open questions for review:

- Do we want per-tenant provider proxying at runtime, or is per-deployment build-time proxying enough for ICF?
- Consent management: where does the consumer's CMP sit relative to the proxied tag?
- Bot filtering and first-party cookie/CORS behavior on the proxy origin.
- For native ingest at scale: queue/edge ingestion before the DB, or defer native client tracking entirely in favor of the proxy?
