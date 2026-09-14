'use client'

import { keys } from '../translations/keys'
import { TIMEFRAME_KEYS } from '../translations/metricKeys'
import { useTranslation } from '../translations/useTranslation'
import type { AnalyticsViewClientProps } from './viewProps'

/**
 * Placeholder shell for the analytics dashboard. The props contract is final; the body
 * (toolbar, cards, trend, breakdowns) lands with the view itself. It already reads the
 * source list and the defaults so a broken prop hand-off fails visibly rather than silently.
 */
export function AnalyticsViewClient({ defaults, sources }: AnalyticsViewClientProps) {
	const { t } = useTranslation()
	const defaultSource =
		sources.sources.find((source) => source.id === sources.defaultId) ?? sources.sources[0]
	const summary = [defaultSource?.label, t(TIMEFRAME_KEYS[defaults.range])]
		.filter(Boolean)
		.join(' · ')

	return (
		<div>
			<h1>{t(keys.viewTitle)}</h1>
			<p>{summary}</p>
			<p>{t(keys.viewLoading)}</p>
		</div>
	)
}
