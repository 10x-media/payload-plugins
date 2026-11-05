---
"@10x-media/analytics": minor
---

**Consent modes: a slot that waits for the consent manager can count without storing anything on the device, before an answer and after a refusal.** `capture.withoutConsent` decides what a held slot does in each phase without consent, and the plugin still stores no consent state and makes no legal decision ([Consent](https://docs.10xmedia.de/analytics/consent)).

**Behavioral:** the default is `'cookieless'`. A slot `capture.gate` holds now counts before the visitor answers and after a refusal, where 1.0.0-beta.14 sent nothing until `setGate(true)`: native as it always did, Plausible and Umami with their usual script, PostHog in posthog-js's cookieless mode. Each request still carries the visitor's IP address and user agent to the vendor or to native ingest. To keep 1.0.0-beta.14 exactly, set one option: `analytics({ capture: { withoutConsent: 'off' } })`, which renders the same tracker config and snippets and sends nothing without consent. An install that leaves the option unset while a held slot can count logs one line per boot naming the default. Whether a site may count without consent is the operator's decision: update the privacy policy and confirm with the data protection officer before shipping the default ([From 1.0.0-beta.14](https://docs.10xmedia.de/analytics/upgrading/beta-15)).

**Upgrade actions**

1. Set `capture.withoutConsent`: `'off'` for 1.0.0-beta.14's behaviour, `'cookieless'` to keep the default, `{ pending, refused }` per phase, or a function `({ slot, adapterId, kind, phase }) => 'cookieless' | 'off'`.
2. With a PostHog slot that counts without consent, turn on the project's **Cookieless tracking** (Settings, Web analytics), or PostHog drops those events, and give the read `apiKey` the `project:read` scope so the adapter can check it.
3. Behind a proxy, set `trustedProxyHops` or `trustedPlatform`: cookieless counting tells visitors apart by a hash of the client address.
4. On Postgres or SQLite in migrate mode, generate and run a migration (four nullable columns). Coming straight from 1.0.0-beta.11 on SQLite, apply the beta.12 page's providers-rebuild edit, which also removes `"without_consent"`.
5. Update a Content Security Policy that allows the PostHog or GA4 snippet by hash.
6. Code implementing `Tracker` or `AnalyticsApi` itself adds `mode`.

**Behavioral:** GA4 stays strict by default: its adapter declares `off` without consent, since its cookieless pings still reach Google. `ga4({ withoutConsent: 'cookieless' })` or a document's field opts it in: the snippet sets consent mode defaults, all four signals denied, before `gtag('config')`, and a grant updates `analytics_storage` alone.

**Behavioral:** a held slot that counts before an answer renders its snippet with the page, in a cookieless variant, so its first pageview counts. A grant runs it in full on the same page; a refusal or a revoke moves it to its refused level. After a revoke the only storage left is PostHog's `__ph_opt_in_out_<token>`: the PostHog sink also removes `ph_<token>_window_id`, and the GA4 sink expires `_ga` and `_ga_<id>` when the page had granted them, strict GA4 slots included.

**Behavioral:** the tracker reads no storage until some slot runs in full: the exclusion flag is read, and the old consent key deleted, only then, so a staff browser is counted by cookieless slots until that point. Plausible and Umami opt-out keys set by an exclusion or a strict refusal are cleared only once the slot runs in full.

**Behavioral:** a page restored from the back/forward cache returns held slots to their pending level, and a vendor already running in full keeps running until the manager answers again.

**Behavioral:** a PostHog read that finds cookieless pageviews reports visitors as a sum of days (`meta.visitorsAre: 'sumOfDaily'`).

**Behavioral:** the native ingest endpoint refuses an `m` other than `'f'`, `'c'` or `'a'` with `400 invalid_param` naming `m`. A beacon without `m` is stored as full.

**Breaking:** `Tracker.mode` and `AnalyticsApi.mode` are required members: each slot's `SlotMode` (`'off'`, `'cookieless'`, `'anonymous'`, `'full'`), `off` everywhere before a tracker boots.

**Additive:** `withoutConsent` on `native()`, `plausible()`, `umami()`, `posthog()` and `ga4()`, which beats the install's option for its slot; a **Without consent** field on PostHog, Plausible, Umami and GA4 provider documents (empty follows the install), with the override key `providers.collection.fields.withoutConsent`.

**Additive:** `native({ withoutConsent: 'anonymous' })` stores what native counts without consent with no visitor id, country only, and no time on page, scroll or items seen. Those hits count toward pageviews, events, goals and most breakdowns, and toward no visitor, visit or bounce rate; an erasure request naming a visitor cannot find them. Each hit stores its mode (`mode`: `f`, `c`, `a`), and server events map `identity: 'request'` to `f` and `'none'` to `a`. ([Anonymous hits](https://docs.10xmedia.de/analytics/native#anonymous-hits)).

**Behavioral:** native's time on page averages over pageviews that have a visitor, so server pageviews recorded with `identity: 'none'` no longer lower it.

**Additive:** reads gain `meta.withoutConsent` and `meta.withoutVisitor` (`{ pageviews }`) and `meta.withoutConsentDropped`. The analytics view shows the share of pageviews counted without consent; a read holding pageviews without a visitor says how many; a PostHog source whose project drops cookieless events says so in the admin. Every new note and field is translated in all built-in languages.

**Additive:** a production boot warning when a held slot can count cookielessly while neither `trustedProxyHops` nor `trustedPlatform` is set.

**Additive:** for adapter authors, `CaptureSupport.cookieless` (`{ kind: 'inherent' | 'switched', default? }`) and `withoutConsent`, `SnippetArgs` with `mode` and `withoutConsent`, `TrackerSlotConfig.withoutConsent`, `AdapterRegisterContext.countsWithoutConsent`, and the types `ConsentPhase`, `CookielessSupport`, `HeldSlotMode`, `HitMode`, `NativeWithoutConsent`, `SlotMode`, `SlotWithoutConsent`, `SnippetMode`, `WithoutConsentArgs`, `WithoutConsentFunction`, `WithoutConsentLevel` and `WithoutConsentOption`. An adapter that declares no `cookieless` sends nothing without consent, as before.

**Schema:** on SQL databases, `analytics_hits.mode`, `analytics_aggregates.pageviews_without_visitor` and `pageviews_without_consent`, and `analytics_providers.without_consent`, all nullable. Days counted before read the new counts as 0, with no recount. On a rolling deploy, a node on the old code that counts a day holding anonymous hits leaves the new counts empty until the day is counted again.
