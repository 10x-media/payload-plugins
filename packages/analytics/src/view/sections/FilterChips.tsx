'use client'

import { Pill, XIcon } from '@payloadcms/ui'
import type { AnalyticsFilter } from '../../core/contract'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { DIMENSION_LABELS } from '../labels'

export interface FilterChipsProps {
	filters: AnalyticsFilter[]
	onRemove: (index: number) => void
}

/** `eq` reads as an equals sign; the other operators say which matching they apply. */
const OPERATOR_SIGN: Record<AnalyticsFilter['operator'], string> = {
	eq: '=',
	contains: '~',
	matches: '≈',
}

/** The filters a view is reading through, each removable on its own. */
export function FilterChips({ filters, onRemove }: FilterChipsProps) {
	const { t } = useTranslation()
	if (filters.length === 0) {
		return null
	}
	return (
		<div className="analytics-view__chips">
			<span className="analytics-view__label">{t(keys.viewFilters)}</span>
			{filters.map((filter, index) => {
				const text = `${t(DIMENSION_LABELS[filter.dimension])} ${OPERATOR_SIGN[filter.operator]} ${filter.value}`
				return (
					<Pill key={`${filter.dimension}:${filter.operator}:${filter.value}`} size="small">
						{text}
						<button
							aria-label={`${t(keys.viewFilterRemove)}: ${text}`}
							className="analytics-view__chip-remove"
							onClick={() => onRemove(index)}
							type="button"
						>
							<XIcon />
						</button>
					</Pill>
				)
			})}
		</div>
	)
}
