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
