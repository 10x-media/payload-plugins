---
"@10x-media/analytics": minor
---

Bucket the per-document trend chart in the reporting timezone, and show a "New" state for documents without analytics yet.

The comparison windows, cache keys, and daily series already resolved on reporting-timezone day boundaries, but the trend chart still bucketed and labelled on UTC days. Any reporting timezone east of UTC (whose day starts fall on the previous UTC calendar day) therefore shifted every axis label, and the weekly and monthly groupings, back by a day. The chart now buckets and labels in the reporting timezone the read resolved in; the read helpers return that zone and the panel carries it in its endpoint payload for client-side re-bucketing. The default stays UTC, so existing installs are unchanged.

A per-document analytics surface with nothing to show now reads as "New" rather than the flat "No analytics yet" line or a row of zeros captioned "No change vs. previous period". That covers both an unsaved or unbound document (no path resolves) and a saved page that has not gathered a single tracked metric yet. Genuine configuration states (not bound, no provider, unavailable) keep their message, since those are setup problems rather than new pages. The "New" label is localized (`keys.stateNew`, English and German) and the `analytics-empty-state` classes are stable hooks for overriding the look.
