'use client'

import { Button, DatePicker } from '@payloadcms/ui'
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
			{/* A single choice of text segments: ghost buttons, the chosen one a pill, the
			    way Payload draws a segmented switch with words in it. */}
			<fieldset className="al-date-editor__presets">
				{[
					{ key: keys.dateAnyTime, range: undefined, selected: !hasDates },
					...PRESETS.map(({ key, range }) => ({ key, range, selected: preset === range })),
				].map(({ key, range, selected }) => (
					<Button
						aria-pressed={selected}
						buttonStyle={selected ? 'pill' : 'ghost'}
						key={range ?? 'any'}
						margin={false}
						onClick={() => selectPreset(range)}
						size="medium"
					>
						{t(key)}
					</Button>
				))}
			</fieldset>
			<div className="al-date-editor__dates">
				<div className="al-date-editor__date">
					<div className="al-panel__label">{t(keys.dateFrom)}</div>
					<DatePicker
						onChange={(value) => setDate('dateFrom', value)}
						placeholder={t(keys.startDate)}
						value={staged.dateFrom ?? ''}
					/>
				</div>
				<div className="al-date-editor__date">
					<div className="al-panel__label">{t(keys.dateTo)}</div>
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

/** What the Date trigger reads. */
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
