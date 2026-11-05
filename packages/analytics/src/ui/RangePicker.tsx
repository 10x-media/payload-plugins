'use client'

import { DatePicker } from '@payloadcms/ui'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { viewerNow } from './viewerClock'
import './analytics.css'

export type RangePickerAppearance = 'default' | 'dayOnly' | 'monthOnly'

/** `P` is date-fns' localized short date, so the days read in the admin's own order. */
const DISPLAY_FORMAT: Record<RangePickerAppearance, string> = {
	default: 'P',
	dayOnly: 'MMM dd',
	monthOnly: 'MMMM yyyy',
}

/** Longer than react-datepicker's two-tick hand-back of focus, short enough not to be noticed. */
const SETTLE_MS = 250

/**
 * What Payload's picker hands back in range mode: both ends, the second still open while it is
 * being picked; `null` from its clear button.
 */
type Picked = Date | null | [Date | null, Date | null]

export interface RangePickerProps {
	start: Date | null
	end: Date | null
	onChange: (start: Date | null, end: Date | null) => void
	appearance?: RangePickerAppearance
	/** Offer Payload's clear button while a day is set. */
	clearable?: boolean
	readOnly?: boolean
	placeholder?: string
	/** The input's id, for the label naming it. */
	inputId?: string
	onCalendarClose?: () => void
	/** The last day that can be picked, today for a report on what already happened. */
	maxDate?: Date
}

const CalendarName = createContext('')

/**
 * react-datepicker's own calendar dialog, named in the admin's language. One component for every
 * picker keeps the calendar mounted across renders, so the name comes through context.
 */
function CalendarDialog({ className, children }: { className?: string; children?: ReactNode }) {
	const name = useContext(CalendarName)
	return (
		<div aria-label={name} aria-modal="true" className={className} role="dialog">
			{children}
		</div>
	)
}

/**
 * The first of the two months shown: the month before the range's last day, else before `maxDate`
 * (or today) when nothing is picked.
 */
export const openingMonth = ({
	start,
	end,
	maxDate,
	today,
}: {
	start: Date | null
	end: Date | null
	maxDate?: Date | undefined
	today: Date
}): Date => {
	const anchor = end ?? start ?? maxDate ?? today
	return new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1)
}

/**
 * Payload's own `DatePicker` in range mode, two months wide, sharing its styles and locale handling;
 * every English string react-datepicker would show goes through `overrides`.
 */
export function RangePicker({
	start,
	end,
	onChange,
	appearance = 'default',
	clearable = false,
	readOnly = false,
	placeholder,
	inputId,
	onCalendarClose,
	maxDate,
}: RangePickerProps) {
	const { t } = useTranslation()
	// react-datepicker 7 hands focus back to the input two ticks after a pick closes the calendar,
	// by when it no longer ignores that focus, so the calendar would open again on its own.
	const [settling, setSettling] = useState(false)
	useEffect(() => {
		if (!settling) {
			return
		}
		const timer = setTimeout(() => setSettling(false), SETTLE_MS)
		return () => clearTimeout(timer)
	}, [settling])
	const onPick = (picked: Picked): void => {
		if (Array.isArray(picked)) {
			onChange(picked[0], picked[1])
			return
		}
		onChange(picked, null)
	}
	const previousMonth = t(keys.dateRangePreviousMonth)
	const nextMonth = t(keys.dateRangeNextMonth)
	const previousYear = t(keys.dateRangePreviousYear)
	const nextYear = t(keys.dateRangeNextYear)
	const held = start ?? end
	return (
		<CalendarName.Provider value={t(keys.dateRangeCalendar)}>
			<DatePicker
				displayFormat={DISPLAY_FORMAT[appearance]}
				monthsToShow={2}
				onChange={onPick}
				overrides={{
					selectsRange: true,
					startDate: start,
					endDate: end,
					openToDate: openingMonth({ start, end, maxDate, today: viewerNow() }),
					...(maxDate === undefined ? {} : { maxDate }),
					...(inputId === undefined ? {} : { id: inputId }),
					preventOpenOnFocus: settling,
					onFocus: () => setSettling(false),
					onCalendarClose: () => {
						setSettling(true)
						onCalendarClose?.()
					},
					previousMonthAriaLabel: previousMonth,
					previousMonthButtonLabel: previousMonth,
					nextMonthAriaLabel: nextMonth,
					nextMonthButtonLabel: nextMonth,
					previousYearAriaLabel: previousYear,
					previousYearButtonLabel: previousYear,
					nextYearAriaLabel: nextYear,
					nextYearButtonLabel: nextYear,
					chooseDayAriaLabelPrefix: t(keys.dateRangeChooseDay),
					disabledDayAriaLabelPrefix: t(keys.dateRangeDayUnavailable),
					monthAriaLabelPrefix: t(keys.dateRangeMonth),
					weekAriaLabelPrefix: t(keys.dateRangeWeek),
					calendarContainer: CalendarDialog,
				}}
				pickerAppearance={appearance}
				{...(placeholder === undefined ? {} : { placeholder })}
				readOnly={readOnly}
				// Payload draws its clear button for a picker holding a value, and only then.
				value={clearable && !readOnly ? (held ?? undefined) : undefined}
			/>
		</CalendarName.Provider>
	)
}
