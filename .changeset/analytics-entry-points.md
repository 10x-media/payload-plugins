---
"@10x-media/analytics": minor
---

**Entry points: a `/site` entry, a smaller `/tracker`, one stylesheet and release tags on every export.** Each entry now exports what its environment uses and nothing it should not load: a site's server components import `/site`, a page's browser code `/tracker`, `/attributes` and `/react`, and the admin `/rsc` and `/client` ([Entry points](https://docs.10xmedia.de/analytics/reference/entry-points)).

**Upgrade actions**

1. Move the imports the table below names.
2. Regenerate the import map (`pnpm payload generate:importmap`).
3. Where your bundler does not follow CSS imports, or a `BarList` or `TrendChart` renders outside the admin, import `@10x-media/analytics/styles.css`.

**Breaking:** exports removed since 1.0.0-beta.11, and what replaces them:

| Entry | Removed | Use instead |
|---|---|---|
| `/rsc` | `AnalyticsScripts`, `AnalyticsScriptsProps`, `getTrackerConfig` | the same from `/site` |
| `/rsc` | `TrackerConfig`, `TrackerSlotConfig` | the same types from `/site`, `/tracker` or `/types` |
| `/rsc` | `widgetCardStyle`, `widgetLabelStyle` | `WidgetCard`, or the `analytics-card analytics-widget` classes |
| `/react` | `TrackerBoot`, `TrackerBootProps` | `<AnalyticsScripts />` or `<AnalyticsProvider>` |
| `/tracker` | `GOAL_ATTRIBUTE`, `OUTBOUND_EVENT`, `DOWNLOAD_EVENT`, `SCROLL_EVENT` | the same from `/attributes` |
| `/tracker` | `readExclusion`, `writeExclusion`, `subscribeExclusion`, `readExclusionParam` | `tracker.excluded` and `tracker.exclude()`, or `excluded` and `setExcluded` from `useAnalytics()` |
| `/tracker` | `CONSENT_QUEUE_LIMIT`, `CONSENT_STORAGE_KEY`, `ConsentState`, `createConsentQueue`, `readConsent`, `writeConsent` | `setGate`, `GateState` and `GateStatus` |
| `/tracker` | `createNoopTracker`, `createAutoCapture`, `AutoCapture`, `AutoCaptureHandlers`, `createPageTracking`, `PageTracking`, `createScriptLoader`, `acquireTracker`, `TrackerLease`, `PAGEVIEW_BUFFER_MS` | `initTracker`, `createTracker` and the components |
| `/tracker` | `createNativeSink`, `createGa4Sink`, `Ga4SinkArgs`, `GA4_DISABLE_PREFIX`, `createPlausibleSink`, `PLAUSIBLE_IGNORE_KEY`, `createPosthogSink`, `createUmamiSink`, `UMAMI_DISABLED_KEY`, `VendorSinkArgs`, `Sink`, `TrackerEvent` | nothing: the tracker builds its own sinks |
| root | `CaptureConsentOption`, `ConsentMode`, `ConsentResolver` | `CaptureGate` |
| root | `PlatformReadAccess`, `ScopesResolver` | `CrossScopeAccess`, `ScopeListResolver` |

**Breaking:** the package declares `"sideEffects": ["*.css"]`, where it declared `false`: every admin module imports the plugin's one stylesheet, which the package also exports as `@10x-media/analytics/styles.css`.

**Breaking:** the widget drawer's pickers and the `goalField()` picker are registered at new server component paths (`@10x-media/analytics/rsc#SourceSelectFieldServer` and its siblings), which read the scope on the server. The five paths 1.0.0-beta.11 registered stay exported, marked `@deprecated` with the server path that replaces each, so an import map generated before the upgrade still renders them, keyed by the scope the page's cookies select; the widget filter's value field and the goal amount control are new paths and render nothing until the import map is regenerated ([Component paths](https://docs.10xmedia.de/analytics/reference/stability#component-paths)).

**Behavioral:** the package depends on `undici` and `ipaddr.js` for the guarded provider fetch, and on `country-flag-icons` for the flag route.

**Behavioral:** every export carries a release tag. An untagged export is stable; `@beta` (the dashboard widgets and the `widgets` option, the `WidgetCard` family, `BarList`, `TrendChart`, `RealtimeCounter`, the widget drawer's pickers, the view's building blocks with `view.Component`, the flag seams, the toolkit for building adapters in `providers.resolve`, `SYSTEM`, `ReadPrincipal` and `GatedScope`, the wire shapes `WireGoal`, `GoalsResponse`, `RawEventInput` and `HitType`, and the GA4 structural types) may change in a minor release; `@internal` is exported for Payload's import map alone; `@deprecated` still works and names its replacement. The component paths the plugin registers are frozen for the 1.x line ([Stability](https://docs.10xmedia.de/analytics/reference/stability)). Of the exports 1.0.0-beta.11 shipped untagged, these are now `@internal`: `AnalyticsView`, `AnalyticsViewProps`, `AnalyticsStatField` and `AnalyticsPanelField` from `/rsc`, and `AnalyticsNavLink`, `AnalyticsNavLinkProps` and `DateRangeField` from `/client`. These are now `@beta`: the built-in widget components, `analyticsDefaultWidgets`, `widgetFilters`, `CustomWidgetDef` and `WidgetFilter`; `BarList`, `TrendChart`, `TrendPoint` and `RealtimeCounter`; `AnalyticsViewClient`, `AnalyticsViewClientProps` and `ViewGoal`; the widget drawer's pickers and their props, `useAnalyticsSources`, `useFilterCapabilities`, `useAnalyticsGoals`, `AnalyticsSources`, `FilterCapabilities`, `WireGoal` and `GoalsResponse`.

**Additive:** the `/site`, `/attributes`, `/migrations` and `/migrations/drop-legacy-mongo` entries and `./styles.css`; the adapter contract types from every adapter entry, `/next` and `/testing`; the view's `@beta` building blocks from `/client` ([Customizing](https://docs.10xmedia.de/analytics/customizing)); `settleAnalytics(payload)` from `/testing`, which waits for the plugin's background work (cache writes, the native engine's upkeep, a write buffer it flushes) before a test reads back or destroys Payload ([Testing](https://docs.10xmedia.de/analytics/reference/adapter-contract#waiting-for-background-work)). Each entry's public surface is recorded in an API report that CI compares on every change, so nothing public changes without a reviewed diff.
