---
"@10x-media/analytics": minor
---

**Consent: the site's consent manager drives a gate, and the plugin stores no decision.** Whether an install needs consent, and for which tracking, is the site's call, so the plugin has no default and no stored state: `capture.gate` says which capture slots wait, and the consent manager opens or closes them with `setGate` on every page load ([Consent](https://docs.10xmedia.de/analytics/consent), with a c15t recipe and a generic one).

**Upgrade actions**

1. Set `capture.gate`: `'all'` holds every slot until the manager answers, `'off'` captures without waiting, a list names the slots that wait, and a function `({ slot, adapterId, kind }) => boolean` decides per slot. `({ kind }) => kind !== 'native'` reproduces what 1.0.0-beta.11 did by default.
2. Replace `tracker.consent('granted')` and `consent('denied')` from `useAnalytics()` with `setGate(true)` and `setGate(false)` (`setGate({ tenant: true })` for one slot), called from your consent manager's bridge on every page load, and again on a `pageshow` event whose `persisted` is true.
3. Remove `persistConsent`, and the imports of `CONSENT_STORAGE_KEY`, `CONSENT_QUEUE_LIMIT`, `ConsentState`, `createConsentQueue`, `readConsent` and `writeConsent` from `/tracker`, and of `CaptureConsentOption`, `ConsentMode` and `ConsentResolver` from the package root (`CaptureGate` types the new option).
4. Import `AnalyticsScripts` and `getTrackerConfig` from `@10x-media/analytics/site`, and replace `TrackerBoot` with `<AnalyticsScripts />` or `<AnalyticsProvider>`.
5. A consent manager that injects the vendor scripts itself: pass `snippets={false}` and let it load each slot's `snippet.scripts`.
6. A Content Security Policy that allows the vendor snippets by hash needs the new hashes: the snippets changed with the gate and the exclusion prelude.
7. Where `capture.gate` holds native, server code that knows the visitor's answer passes `identity: 'request'` to `trackServerEvent`, `purchase`, `refund` or `trackGoalAction` ([What the gate does not cover](https://docs.10xmedia.de/analytics/consent#what-the-gate-does-not-cover)).

**Breaking:** `capture.gate` is required whenever a capture slot can fill, the native one included, and the boot stops without it, naming the choices.

**Breaking:** no consent decision is stored. The tracker never reads the `analytics:consent` key 1.0.0-beta.11 wrote, and deletes it once a slot opens, so a returning visitor is pending until the manager answers again.

**Breaking:** `Tracker.consent` and `useAnalytics().consent` are replaced by `setGate(state)` and the read-only `gate`: both are required members of `Tracker`, `setGate` of `AnalyticsCommands` and `gate` of `AnalyticsApi`. Code that implements `Tracker` itself, such as a test double, adds them. `TrackerOptions.persistConsent` is removed.

**Breaking:** `TrackerSlotConfig.requiresConsent` is `gated`, now required. A tracker config a browser cached from 1.0.0-beta.11 is still read, and a slot carrying neither field is held.

**Behavioral:** while a slot is pending its events wait in a queue of 100 (engagement only for a native slot); a decision before the tracker exists is applied when it boots. Closing a slot drops its queue, stops delivery and, where the vendor's script may have run, sets its own opt-out (Plausible's and Umami's keys, PostHog's `opt_out_capturing()`, GA4's disable flag and a consent mode update denying all four storage types). Opening one clears that opt-out unless the browser is excluded, injects the slot's snippet and sends what waited. A slot the config does not fill reads `closed` and ignores answers.

**Behavioral:** nothing reads or writes the browser's storage before a slot opens: the exclusion flag is read, and the old consent key deleted, when the first slot opens, so `excluded` reads `false` until then. Before any answer only these touch it: the signed exclusion link a staff member opens and the `=0` link (which removes the flag when set), the GA4 snippet of a slot that does not wait (it reads the exclusion flag), and the vendors' opt-out switches a refusal sets under `snippets: false`.

**Behavioral:** a page restored from the back/forward cache puts its held slots back to pending rather than keeping the answer it had, which the visitor may have revoked in another tab since; the manager answers again from its `pageshow` handler.

**Behavioral:** server tracking (`trackServerEvent`, the server `purchase` and `refund`, and `trackGoalAction`) records an event as no visitor's by default while `capture.gate` holds a slot native may fill: no visitor id, and no location, device or language read from the request. With `gate: 'off'` it keeps the request's visitor, and `identity: 'request'` or `'none'` decides per call. An `ip` or `userAgent` passed without an `identity` and set aside by that default is logged once.

**Behavioral:** on the server, a slot that does not wait renders its vendor snippet with the page and a slot that waits renders nothing until it opens; its snippet travels as data in the tracker config. A server that knows the decision passes `gate`, as in `<AnalyticsScripts config={tracker} gate={{ tenant: true }} />` ([Server render](https://docs.10xmedia.de/analytics/consent#server-render)).

**Behavioral:** PostHog's snippet initialises with `opt_out_persistence_by_default`, so its opt-out also deletes its own storage, and lifting the opt-out sends no `$opt_in`.

**Additive:** `setGate`, `gate`, `GateState`, `GateStatus`, `CaptureGate` and `CaptureGateArgs`; `gate` and `snippets` on `<AnalyticsScripts />`, `<AnalyticsProvider>` and `createTracker`; the beacon's `ageMs`, the time an event waited in the browser (at most a day), which ingest subtracts so a held event is filed when it happened rather than when its slot opened. `loadScript` stays on `<AnalyticsProvider>` and `createTracker` for a framework's script loader.
