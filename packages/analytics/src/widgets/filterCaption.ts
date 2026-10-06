import type { AnalyticsFilter } from '../core/contract'
import { keys } from '../translations/keys'
import { FILTER_OPERATOR_KEYS } from '../translations/metricKeys'
import type { Translate } from '../translations/server'
import { DIMENSION_LABELS } from '../view/labels'

/**
 * One filter as a sentence a caption can end on ("where Country is DE"). Both parts are
 * translated before they reach the sentence, which is itself a translated template, so a
 * locale can reorder them. The value is the editor's own text and is never translated.
 */
export const filterCaption = (filter: AnalyticsFilter, t: Translate): string =>
	t(keys.widgetFilterCaption, {
		dimension: t(DIMENSION_LABELS[filter.dimension]),
		operator: t(FILTER_OPERATOR_KEYS[filter.operator]),
		value: filter.value,
	})

/**
 * A widget's caption: its window, and the filter sentence after it when there is one. The
 * join is a translated template too, so a locale that does not separate the two with a
 * space (zh) does not get one.
 */
export const captionWithFilter = (
	windowCaption: string,
	filter: AnalyticsFilter | undefined,
	t: Translate
): string =>
	filter
		? t(keys.widgetCaptionWithFilter, {
				window: windowCaption,
				filter: filterCaption(filter, t),
			})
		: windowCaption
