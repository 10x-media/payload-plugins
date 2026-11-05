---
"@10x-media/analytics": minor
---

**Options for hosts that build their own admin around the plugin: a view without its nav link, a source name per reader, and a dashboard layout per reader.** None changes an install that does not set it ([A source's name](https://docs.10xmedia.de/analytics/providers#a-sources-name), [A layout per reader](https://docs.10xmedia.de/analytics/widgets#a-layout-per-reader), [Options](https://docs.10xmedia.de/analytics/analytics-view#options)).

**Additive:** `view.navLink` (default `true`). `false` registers the view at its path without its link in the admin nav, in place of filtering `admin.components.afterNavLinks`.

**Additive:** `label` on `native()`, `plausible()`, `umami()`, `ga4()` and `posthog()`: a string, a map by admin language (read in the reader's language, then `i18n.fallbackLanguage`, then `en`, as `view.navLabel` is), or `({ req, scope }) => string | Promise<string>` naming the source per reader, so staff can read "Platform (PostHog)" where a tenant reads its own site's name. Where no reader is known the name is the string, else the map's `en` or first entry, else the vendor's name; a function that throws or answers blank falls back to it with a warning. A provider document's source keeps the document's name.

**Additive:** `AnalyticsAdapter.labelFor`, the optional per-reader name a custom adapter can declare, and the types `AdapterLabelOption` and `AdapterLabelArgs`.

**Additive:** `analyticsDefaultLayout(options?)` (`@beta`) from the package root, for `admin.dashboard.defaultLayout`: the default widgets less those the reader's default source cannot serve (realtime, goals, a breakdown's dimension, a metric). It keeps widgets that are not the plugin's and widgets naming their own `dataSource`, returns the full list when the reader may read no source, and narrows `options.widgets` when given. `analyticsDefaultWidgets()` is unchanged.
