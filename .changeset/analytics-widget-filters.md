---
"@10x-media/analytics": minor
---

**Additive: widget filters.** Metric, trend and breakdown widgets take one optional filter (dimension, operator, value). The dimension is the gate, the operator defaults to `eq`, and the value is trimmed and capped at 256 characters; a dimension without a value fails validation rather than saving a filter that narrows nothing. The two pickers offer only what the widget's chosen data source declares as filterable, in contract order, falling back to the union over the request's sources when no source is chosen, and a stored value the current source no longer offers stays visible and clearable. The read applies the filter, the caption states it ("Last 30 days where Country is DE"), and the "Open in Analytics" link carries it into the view as `filters=`.

A source that cannot apply the stored filter renders "This source cannot apply this filter" rather than silently ranking unfiltered rows: `readForWidget`, `readForWidgetBreakdown` and `readForWidgetSeries` answer `status: 'filter-unsupported'` without querying the adapter. Because the pickers offer the union when no source is chosen, a dimension filterable on one source and an operator declared on another can be configured together and answered this way at read time.

**Breaking (types): `WidgetReadStatus` gains `'filter-unsupported'`.** The type is exported from `/rsc`, so an exhaustive `Record<Exclude<WidgetReadStatus, 'ok'>, T>` or a switch a consumer wrote over it stops compiling until the new member is handled. Runtime behavior of existing code is unaffected; the compiler is the thing that breaks.

**Behavioral: a widget filter that the source cannot apply now reads `filter-unsupported` where it read `unavailable` before.** Code branching on `status === 'unavailable'` to render its own "no data" message will stop matching those reads.

**Behavioral: a widget's caption renders only with the data it describes.** The breakdown widget used to render its range caption above a not-configured, unavailable or filter-unsupported message, captioning a window it had not read; it now returns title, message and link, as the metric and trend widgets already did.

**Behavioral: the caption's join is translatable.** The window and the filter sentence were joined with a hard-coded space. The join is its own key now, `widgetCaptionWithFilter` (`'{{window}} {{filter}}'`), so a locale can reorder the two or drop the space; `zh` ships without it. The sentence itself stays `widgetFilterCaption` (`'where {{dimension}} {{operator}} {{value}}'`). Both are overridable through the `translations` option.

**Additive API.** `widgetFilters` and the `WidgetFilter` type are exported from the root entry, so a custom widget storing the built-in filter group turns it into an `AnalyticsFilter[]` under the same rules. `FilterDimensionSelectField`, `FilterOperatorSelectField`, `useFilterCapabilities` and the `AnalyticsSources` type are exported from `/client`; `FilterCapabilities` carries `resolved` alongside `loading` and `error`, and `useAnalyticsSources` reports `loading` and `error` beside `sources`. The server `Translate` type accepts interpolation vars. 15 new translation keys ship in all 11 locales.
