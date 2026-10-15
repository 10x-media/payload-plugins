---
"@10x-media/analytics": minor
---

**A tenant's own PostHog captures beside the platform's PostHog.** When both capture slots resolve to PostHog, the tenant slot runs as a second posthog-js client named `tenant`, so one page captures into both projects, each with its own gate, opt-out and exclusion ([Two PostHog projects on one page](https://docs.10xmedia.de/analytics/capture#two-posthog-projects-on-one-page), [From 1.0.0-beta.12](https://docs.10xmedia.de/analytics/upgrading/beta-13#a-tenants-own-posthog)).

**Upgrade actions**

1. To keep 1.0.0-beta.12's behavior, set `capture.slots.tenant: false`, which empties the tenant slot for every tenant.
2. A site that loads the vendor scripts itself (`snippets={false}`) starts the tenant's project as the named client, with pageviews off: `posthog.init(token, { api_host, capture_pageview: false }, 'tenant')`. Started any other way, the tenant slot finds no client and sends nothing.
3. A Content Security Policy that allows the PostHog snippet by hash needs the new hashes.

**Behavioral:** 1.0.0-beta.12 left the tenant slot out with a warning; it now captures, so a tenant's own PostHog project receives events it never did. The named client starts with `capture_pageview: false` and `capture_pageleave: true` and gets the tracker's own pageviews as `$pageview`; the platform's client keeps `capture_pageview: 'history_change'`. Each project counts each pageview once, and `array.js` loads once.

**Behavioral:** each PostHog slot opens, closes and is excluded on its own client: `setGate({ tenant: false })` opts out `posthog.tenant` and leaves the platform's client capturing. PostHog stores each client's state under its own project token.

**Behavioral:** PostHog's snippet no longer replaces a posthog-js already loaded on the page; it starts the slot's client on it. The snippet's text changed, so its CSP hash did.

**Behavioral:** a second slot of Plausible, Umami or GA4 is still left out of the tracker config with a warning, as before.

**Additive:** `instance` on `TrackerSlotConfig` and on `CaptureSupport.snippet`'s arguments, naming the client a slot captures with.
