'use client'

import { barShares } from '../charts/bars'
import { readingOf } from '../core/metricValues'
import { rowCurrencyOf } from '../goals/currency'
import { intlLocale } from '../translations/intl'
import { keys, type TranslationKey } from '../translations/keys'
import { metricLabelKey } from '../translations/metricKeys'
import { useTranslation } from '../translations/useTranslation'
import { DataTable } from '../ui/components/DataTable'
import { toDisplayRows } from '../ui/rows/toDisplayRows'
import { type CountryFlags, RowFlag } from '../view/CountryFlag'
import { DIMENSION_LABELS } from '../view/labels'
import { formatMetricValue } from './format'
import type { FieldBreakdown } from './readForDocument'

/**
 * What each item list is about, which its dimension's own name would not say, by what it was
 * read as: the people who clicked, or, from a source that cannot tell them apart, the clicks.
 */
const itemListLabel = (
	block: Pick<FieldBreakdown, 'dimension' | 'metric'>
): TranslationKey | undefined => {
	const clicks = block.metric === 'interactions'
	switch (block.dimension) {
		case 'page':
			return keys.itemPagesSeenOn
		case 'country':
			return clicks ? keys.itemClicksByCountry : keys.itemClickCountries
		case 'device':
			return clicks ? keys.itemClicksByDevice : keys.itemClickDevices
		default:
			return undefined
	}
}

interface PanelListProps {
	block: FieldBreakdown
	/** The list belongs to an item report, which names its lists by what they rank. */
	item: boolean
	countryFlags: CountryFlags
	/** ISO 4217 code revenue renders in; absent leaves it a plain number. */
	currency: string | undefined
}

/** One ranked list of the panel: a dimension's top values with a bar for each one's share. */
export function PanelList({ block, item, countryFlags, currency }: PanelListProps) {
	const { t, i18n } = useTranslation()
	const locale = intlLocale(i18n.language)
	const heading = t((item ? itemListLabel(block) : undefined) ?? DIMENSION_LABELS[block.dimension])
	const rows = toDisplayRows(
		block.rows.map((row) => ({
			value: row.value,
			metrics: { [block.metric]: row.metric },
		})),
		{
			dimension: block.dimension,
			provider: block.provider ?? '',
			t,
			locale,
			countryFlags: countryFlags !== false,
		}
	)
	const values = rows.map((row) => readingOf(row.metrics, block.metric))
	const shares = barShares(values)
	return (
		<div className="analytics-panel__list">
			<span className="analytics-panel__label">{heading}</span>
			<DataTable
				bars="soft"
				columns={[
					{
						key: block.metric,
						header: t(metricLabelKey(block.metric, block.visitorsSummed)),
						className: 'analytics-bars__value',
					},
				]}
				emptyLabel={t(keys.stateNoBreakdown)}
				head="hidden"
				label={heading}
				labelHeader={t(DIMENSION_LABELS[block.dimension])}
				noValueLabel={t(keys.stateNoValue)}
				rows={rows.map((row, i) => ({
					key: row.key,
					label: row.label,
					bar: shares[i] ?? 0,
					...(row.flag === null
						? {}
						: { decoration: <RowFlag code={row.flag} flags={countryFlags} /> }),
					cells: [
						formatMetricValue(block.metric, values[i] ?? null, {
							locale,
							currency: rowCurrencyOf(block.dimension, row.value, currency),
						}),
					],
				}))}
			/>
		</div>
	)
}
