import type { PayloadRequest } from 'payload'
import type { AnalyticsFilter } from '../core/contract'
import { resolveItemLabels } from '../plugin/itemLabels'
import { getRuntime, resolveGoalsFor } from '../plugin/runtime'
import { intlLocale } from '../translations/intl'
import { asTranslate } from '../translations/server'
import { valueLabel } from '../view/labels'

type GoalName = { slug: string; name: string }

/** What the read says about its labels: the source that answered and the goals it named. */
export interface LabelledRead {
	provider?: string | undefined
	goals?: ReadonlyArray<GoalName> | undefined
}

const goalNames = async (req: PayloadRequest): Promise<GoalName[]> => {
	const runtime = getRuntime(req.payload)
	if (!runtime) {
		return []
	}
	const goals = await resolveGoalsFor(runtime, req).catch((): GoalName[] => [])
	return goals.map(({ slug, name }) => ({ slug, name }))
}

/**
 * A filter value as the view's chip names it (via {@link valueLabel}). A goal or item the
 * widget cannot look up keeps its stored value rather than reading as loading or removed.
 */
export const filterValueLabel = async (
	req: PayloadRequest,
	filter: AnalyticsFilter,
	{ provider, goals }: LabelledRead
): Promise<string> => {
	const translate = req.i18n?.t
	if (translate === undefined) {
		return filter.value
	}
	const args = {
		dimension: filter.dimension,
		value: filter.value,
		provider: provider ?? '',
		t: asTranslate(translate),
		locale: intlLocale(req.i18n.language),
	}
	if (filter.dimension === 'goal') {
		return valueLabel({ ...args, goals: goals ?? (await goalNames(req)) })
	}
	if (filter.dimension === 'item') {
		const itemLabels = await resolveItemLabels(req, [filter.value]).catch(
			(): undefined => undefined
		)
		return itemLabels === undefined ? filter.value : valueLabel({ ...args, itemLabels })
	}
	return valueLabel(args)
}
