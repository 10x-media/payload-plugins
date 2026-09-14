'use client'

import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import type { AnalyticsViewClientProps } from './viewProps'

/**
 * Placeholder shell for the analytics dashboard. The props contract is final; the body
 * (toolbar, cards, trend, breakdowns) lands with the view itself.
 */
export function AnalyticsViewClient(_props: AnalyticsViewClientProps) {
	const { t } = useTranslation()
	return (
		<div>
			<h1>{t(keys.viewTitle)}</h1>
			<p>{t(keys.viewLoading)}</p>
		</div>
	)
}
