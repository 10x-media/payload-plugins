import type { AnalyticsFilter } from '../core/contract'
import { keys } from '../translations/keys'
import { FILTER_OPERATOR_KEYS } from '../translations/metricKeys'
import { isolate } from '../translations/parts'
import type { Translate } from '../translations/server'
import { DIMENSION_LABELS } from '../view/labels'

/** A filter with the value as a reader knows it (see `filterValueLabel`), when it was looked up. */
export type CaptionFilter = AnalyticsFilter & { shown?: string }

/**
 * One filter as a caption sentence ("where Country is Germany"), worded like the view's chip.
 * The value (`shown`, else stored) is bidi-isolated so a path keeps its direction in RTL text.
 */
export const filterCaption = (filter: CaptionFilter, t: Translate): string =>
	t(keys.widgetFilterCaption, {
		dimension: t(DIMENSION_LABELS[filter.dimension]),
		operator: t(FILTER_OPERATOR_KEYS[filter.operator]),
		value: isolate(filter.shown ?? filter.value),
	})

/**
 * A widget's caption: its window, then the filter sentence when there is one. The join is a
 * translated template too, since some locales (zh) put no space between them.
 */
export const captionWithFilter = (
	windowCaption: string,
	filter: CaptionFilter | undefined,
	t: Translate
): string =>
	filter
		? t(keys.widgetCaptionWithFilter, {
				window: windowCaption,
				filter: filterCaption(filter, t),
			})
		: windowCaption
