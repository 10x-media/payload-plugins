---
"@10x-media/analytics": minor
---

**Fixed: a failed goal resolver no longer poisons the healthy cache entry.** When the goals resolver threw, the read carried an empty goal hint, the provider answered `meta.goalsUnresolved`, and the engine cached that answer at the aggregate TTL under the same key a healthy read with no goals uses. The hint is now three-way: the scope's slugs (an empty list when no goals are configured, which is an empty result rather than a failure), `'unresolved'` when the resolver failed (its own `goals:!unresolved` cache segment, which no list of slugs can produce, and the short realtime TTL), or absent when the read does not ask about goals.

**Behavioral for adapter authors: `AnalyticsQuery.goalSlugs` is typed `string[] | 'unresolved'`.** An adapter that reads the hint must handle the sentinel: the slugs to filter goal rows by, an empty list to filter by none, or a failure to report as `meta.goalsUnresolved` rather than as an empty table. The built-in provider adapters answer all three through one shared helper. `GET /api/analytics/query` echoes the hint it used under `query.goalSlugs`, so a client can tell a scope with no goals from a resolver that failed.

**Fixed: a scope with no goals says so instead of reading as nobody converting.** The goals panel, the goals widget and both goal breakdowns fell through to the plain "No data yet" whenever the scope configured no goals. They now render `stateNoGoals` ("No goals are configured for this scope", in all 11 locales) for that case, keeping the unresolved-goals state for a source that could not answer at all.

**Fixed: a sampled native read says so everywhere.** A filtered or hourly native read that hits the event scan limit sets `meta.sampled`; `realtime()` now sets it too (both paths build their meta through one `eventScanMeta`), and the view and the widgets show a notice for it beside the clamped and stale ones instead of presenting truncated numbers as exact. **Additive:** the realtime strip and the realtime widget carry the notice through their polls, and `RealtimeCounter` gained two optional props for it, `initialSampled` and `sampledLabel`, with no notice rendered when the label is left off.

**Behavioral: every widget carries the same read flags.** The five widget read helpers share one prologue and one meta mapping, so the metric widget now shows the unresolved-goals notice for `conversions` and the trend widget shows the stale notice, both of which they used to omit while their siblings showed them.

**Fixed: the realtime endpoint answers 503 with `Retry-After` when its source fails**, matching the query endpoint, instead of an unhandled 500. A gate that throws is not retryable and answers 500 instead, since polling again cannot fix a configuration bug. The realtime, sources and document endpoints send `cache-control: private, no-store` like the query endpoint, since all of them answer per reader.

**Behavioral: `analyticsDefaultWidgets()` lists every built-in widget.** The default dashboard layout stopped at the seven widgets of Phase 3a and omitted goals, realtime, referrers, browsers, operating systems, campaigns and events; it now places all of them. Installs that passed their own layout are unaffected.
