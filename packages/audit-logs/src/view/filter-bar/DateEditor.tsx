'use client'

import { DatePicker, PillSelector } from '@payloadcms/ui'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import type { Filters } from '../types'
import { type DateRange, matchingRange, rangeStart } from '../utils'
import type { EditorProps } from './types'
import { formatDatePill } from './utils'

type Translate = (key: (typeof keys)[keyof typeof keys]) => string

const PRESETS: { key: (typeof keys)[keyof typeof keys]; range: DateRange }[] = [
	{ key: keys.dateLast24h, range: '24h' },
	{ key: keys.dateLast7d, range: '7d' },
	{ key: keys.dateLast30d, range: '30d' },
]

const toISO = (value: unknown): string | undefined => {
	if (value instanceof Date) return value.toISOString()
	return typeof value === 'string' && value ? value : undefined
}

/**
 * One date range, with presets as shortcuts: a preset fills From relative to now
 * and clears To, and the pickers show exactly what is filtered.
 */
export function DateEditor({ setStaged, staged }: EditorProps) {
	const { t } = useTranslation()
	const hasDates = Boolean(staged.dateFrom || staged.dateTo)
	const preset = matchingRange(staged.dateFrom, staged.dateTo)

	const selectPreset = (range?: DateRange) =>
		setStaged(
			(f): Filters => ({ ...f, dateFrom: range ? rangeStart(range) : undefined, dateTo: undefined })
		)

	const setDate = (field: 'dateFrom' | 'dateTo', value: unknown) =>
		setStaged((f): Filters => ({ ...f, [field]: toISO(value) }))

	return (
		<div className="al-date-editor">
			<PillSelector
				onClick={({ pill }) =>
					selectPreset(pill.name === 'any' ? undefined : (pill.name as DateRange))
				}
				pills={[
					{ Label: t(keys.dateAnyTime), name: 'any', selected: !hasDates },
					...PRESETS.map(({ key, range }) => ({
						Label: t(key),
						name: range,
						selected: preset === range,
					})),
				]}
			/>
			<div className="al-date-editor__dates">
				<div className="al-date-editor__date">
					<div className="al-filterpopover__editor-label">{t(keys.dateFrom)}</div>
					<DatePicker
						onChange={(value) => setDate('dateFrom', value)}
						placeholder={t(keys.startDate)}
						value={staged.dateFrom ?? ''}
					/>
				</div>
				<div className="al-date-editor__date">
					<div className="al-filterpopover__editor-label">{t(keys.dateTo)}</div>
					<DatePicker
						onChange={(value) => setDate('dateTo', value)}
						placeholder={t(keys.endDate)}
						value={staged.dateTo ?? ''}
					/>
				</div>
			</div>
		</div>
	)
}

/** What the Date pill reads when closed. */
export const dateFilterValue = (staged: Filters, t: Translate): string => {
	const range = matchingRange(staged.dateFrom, staged.dateTo)
	const preset = PRESETS.find((p) => p.range === range)
	if (preset) return t(preset.key)
	if (staged.dateFrom && staged.dateTo)
		return `${formatDatePill(staged.dateFrom)} – ${formatDatePill(staged.dateTo)}`
	if (staged.dateFrom) return `≥ ${formatDatePill(staged.dateFrom)}`
	if (staged.dateTo) return `≤ ${formatDatePill(staged.dateTo)}`
	return t(keys.dateAnyTime)
}
