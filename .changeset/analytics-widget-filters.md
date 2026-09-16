---
"@10x-media/analytics": minor
---

**Additive: widget filters.** Metric, trend and breakdown widgets take one optional filter (dimension, operator, value). The dimension is the gate, the operator defaults to `eq`, and the value is trimmed and capped at 256 characters; a dimension without a value fails validation rather than saving a filter that narrows nothing. The two pickers offer only what the widget's chosen data source declares as filterable, in contract order, falling back to the union over the request's sources when no source is chosen, and a stored value the current source no longer offers stays visible and clearable. The read applies the filter, the caption states it ("Last 30 days where Country is DE", a translated template with reorderable `{{dimension}} {{operator}} {{value}}` vars), and the "Open in Analytics" link carries it into the view as `filters=`.

A source that cannot apply the stored filter renders "This source cannot apply this filter" rather than silently ranking unfiltered rows: `readForWidget`, `readForWidgetBreakdown` and `readForWidgetSeries` answer `status: 'filter-unsupported'` without querying the adapter. Because the pickers offer the union when no source is chosen, a dimension filterable on one source and an operator declared on another can be configured together and answered this way at read time.

**Behavioral: a widget's caption renders only with the data it describes.** The breakdown widget used to render its range caption above a not-configured, unavailable or filter-unsupported message, captioning a window it had not read; it now returns title, message and link, as the metric and trend widgets already did.

**Behavioral:** `WidgetReadStatus` gains `'filter-unsupported'`. Code that switches exhaustively over the status of a `readForWidget*` result has a new case to handle.

**Additive API:** `FilterDimensionSelectField`, `FilterOperatorSelectField`, `useFilterCapabilities` and the `AnalyticsSources` type are exported from `/client`; `useAnalyticsSources` now reports `loading` and `error` alongside `sources`. The server `Translate` type accepts interpolation vars. 14 new translation keys ship in all 11 locales.
