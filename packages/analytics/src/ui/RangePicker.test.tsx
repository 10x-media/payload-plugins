import { cleanup, render, screen } from '@testing-library/react'
import type { ElementType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { openingMonth, RangePicker } from './RangePicker'

interface PickerProps {
	displayFormat?: string
	monthsToShow?: number
	onChange?: (picked: unknown) => void
	overrides?: Record<string, unknown>
	pickerAppearance?: string
	readOnly?: boolean
	value?: Date | string
}

const mocks = vi.hoisted(() => ({ props: [] as PickerProps[] }))

vi.mock('@payloadcms/ui', () => ({
	// Draws the calendar's container as react-datepicker would, with nothing inside it.
	DatePicker: (props: PickerProps) => {
		mocks.props.push(props)
		const Container = props.overrides?.calendarContainer as ElementType | undefined
		return Container ? <Container className="react-datepicker" /> : null
	},
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

afterEach(() => {
	cleanup()
	mocks.props = []
})

const lastProps = (): PickerProps => {
	const props = mocks.props.at(-1)
	if (!props) throw new Error('no picker rendered')
	return props
}

const start = new Date(2026, 9, 5)
const end = new Date(2026, 9, 14)

describe('RangePicker', () => {
	it("renders Payload's picker in range mode with two months", () => {
		render(<RangePicker end={end} onChange={() => {}} start={start} />)
		const props = lastProps()
		expect(props.monthsToShow).toBe(2)
		expect(props.overrides).toMatchObject({
			selectsRange: true,
			startDate: start,
			endDate: end,
			openToDate: new Date(2026, 8, 1),
		})
		expect(props.displayFormat).toBe('P')
	})

	// The second month on screen is the one the range ends in, so its last day is in view.
	it('opens on the month before the range ends and that month', () => {
		expect(openingMonth({ start, end, today: new Date(2026, 11, 24) }).getTime()).toBe(
			new Date(2026, 8, 1).getTime()
		)
		expect(
			openingMonth({ start: new Date(2026, 0, 3), end: null, today: new Date(2026, 11, 24) })
		).toEqual(new Date(2025, 11, 1))
		expect(
			openingMonth({
				start: null,
				end: null,
				maxDate: new Date(2026, 9, 8),
				today: new Date(2027, 0, 1),
			})
		).toEqual(new Date(2026, 8, 1))
		expect(openingMonth({ start: null, end: null, today: new Date(2026, 9, 8) })).toEqual(
			new Date(2026, 8, 1)
		)
	})

	it('offers no day after the one it is told is the last', () => {
		const today = new Date(2026, 9, 8)
		render(<RangePicker end={null} maxDate={today} onChange={() => {}} start={null} />)
		expect(lastProps().overrides).toMatchObject({
			maxDate: today,
			openToDate: new Date(2026, 8, 1),
		})
	})

	it('labels the calendar navigation through the plugin translations', () => {
		render(<RangePicker end={end} onChange={() => {}} start={start} />)
		expect(lastProps().overrides).toMatchObject({
			previousMonthAriaLabel: keys.dateRangePreviousMonth,
			nextMonthAriaLabel: keys.dateRangeNextMonth,
			previousYearAriaLabel: keys.dateRangePreviousYear,
			nextYearAriaLabel: keys.dateRangeNextYear,
		})
	})

	// react-datepicker reads "Choose", "Not available", "Month" and "Week" before each date.
	it("words the calendar's own announcements through the plugin translations", () => {
		render(<RangePicker end={end} onChange={() => {}} start={start} />)
		expect(lastProps().overrides).toMatchObject({
			chooseDayAriaLabelPrefix: keys.dateRangeChooseDay,
			disabledDayAriaLabelPrefix: keys.dateRangeDayUnavailable,
			monthAriaLabelPrefix: keys.dateRangeMonth,
			weekAriaLabelPrefix: keys.dateRangeWeek,
		})
		const dialog = screen.getByRole('dialog', { name: keys.dateRangeCalendar })
		expect(dialog.getAttribute('aria-modal')).toBe('true')
		expect(dialog.className).toBe('react-datepicker')
	})

	it('hands both ends of a pick back, the second still open mid-pick', () => {
		const onChange = vi.fn()
		render(<RangePicker end={null} onChange={onChange} start={null} />)
		lastProps().onChange?.([start, null])
		lastProps().onChange?.([start, end])
		lastProps().onChange?.(null)
		expect(onChange.mock.calls).toEqual([
			[start, null],
			[start, end],
			[null, null],
		])
	})

	it("offers Payload's clear button only when clearable and editable", () => {
		render(<RangePicker clearable end={end} onChange={() => {}} start={start} />)
		expect(lastProps().value).toBe(start)
		cleanup()
		render(<RangePicker clearable end={end} onChange={() => {}} readOnly start={start} />)
		expect(lastProps().value).toBeUndefined()
		cleanup()
		render(<RangePicker end={end} onChange={() => {}} start={start} />)
		expect(lastProps().value).toBeUndefined()
	})

	it('formats the days by the appearance it is given', () => {
		render(<RangePicker appearance="monthOnly" end={end} onChange={() => {}} start={start} />)
		expect(lastProps().displayFormat).toBe('MMMM yyyy')
		expect(lastProps().pickerAppearance).toBe('monthOnly')
	})
})
