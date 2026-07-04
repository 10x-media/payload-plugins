'use client'

import {
	FieldDescription,
	FieldError,
	FieldLabel,
	TimezonePicker,
	useConfig,
	useForm,
	useFormFields,
	withCondition,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { GroupFieldClientProps } from 'payload'
import { forwardRef, useCallback, useMemo, useState } from 'react'
import type { ReactDatePickerCustomHeaderProps } from 'react-datepicker'
import ReactDatePicker from 'react-datepicker'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { DateRangeStyles } from './styles'
import type { DateRangeFieldOptions, DateRangePickerAppearance } from './types'

const baseClass = 'date-time-field'
const pickerClass = 'date-time-picker'

const YEARS = Array.from({ length: 201 }, (_, i) => 1900 + i)

const getMonthNames = (locale: string): string[] =>
	Array.from({ length: 12 }, (_, i) =>
		new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2000, i))
	)

interface AppearanceConfig {
	dateFormat: string
	showMonthYearPicker?: boolean
}

const APPEARANCE_CONFIG: Record<DateRangePickerAppearance, AppearanceConfig> = {
	default: { dateFormat: 'MM/dd/yyyy' },
	dayOnly: { dateFormat: 'MMM dd' },
	monthOnly: {
		dateFormat: 'MMMM yyyy',
		showMonthYearPicker: true,
	},
}

/** Pin a picked date to noon UTC so the stored ISO date does not shift a day across timezones. */
const normalizeDate = (date: Date | null): Date | null => {
	if (!date) return null
	const normalized = new Date(date)
	normalized.setUTCHours(12, 0, 0, 0)
	return normalized
}

const makeDefaultHeader =
	(months: string[]) =>
	({
		monthDate,
		customHeaderCount,
		changeMonth,
		changeYear,
		decreaseMonth,
		increaseMonth,
		prevMonthButtonDisabled,
		nextMonthButtonDisabled,
	}: ReactDatePickerCustomHeaderProps) => {
		const month = monthDate.getMonth()
		const year = monthDate.getFullYear()

		if (customHeaderCount === 1) {
			return (
				<div className="date-range-calendar__header">
					<div className="react-datepicker__header__dropdown date-range-calendar__month-label">
						{months[month]} {year}
					</div>
					<button
						aria-label="Next Month"
						className="react-datepicker__navigation react-datepicker__navigation--next"
						disabled={nextMonthButtonDisabled}
						onClick={increaseMonth}
						type="button"
					>
						<span className="react-datepicker__navigation-icon react-datepicker__navigation-icon--next">
							Next Month
						</span>
					</button>
				</div>
			)
		}

		return (
			<div className="date-range-calendar__header">
				<button
					aria-label="Previous Month"
					className="react-datepicker__navigation react-datepicker__navigation--previous"
					disabled={prevMonthButtonDisabled}
					onClick={decreaseMonth}
					type="button"
				>
					<span className="react-datepicker__navigation-icon react-datepicker__navigation-icon--previous">
						Previous Month
					</span>
				</button>
				<div className="react-datepicker__header__dropdown react-datepicker__header__dropdown--select">
					<div className="react-datepicker__month-dropdown-container react-datepicker__month-dropdown-container--select">
						<select
							className="react-datepicker__month-select"
							onChange={(e) => changeMonth(Number(e.target.value))}
							value={month}
						>
							{months.map((name, index) => (
								<option key={name} value={index}>
									{name}
								</option>
							))}
						</select>
					</div>
					<div className="react-datepicker__year-dropdown-container react-datepicker__year-dropdown-container--select">
						<select
							className="react-datepicker__year-select"
							onChange={(e) => changeYear(Number(e.target.value))}
							value={year}
						>
							{YEARS.map((y) => (
								<option key={y} value={y}>
									{y}
								</option>
							))}
						</select>
					</div>
				</div>
			</div>
		)
	}

const renderMonthOnlyHeader = ({
	monthDate,
	customHeaderCount,
	changeYear,
	decreaseYear,
	increaseYear,
	prevYearButtonDisabled,
	nextYearButtonDisabled,
}: ReactDatePickerCustomHeaderProps) => {
	const year = monthDate.getFullYear()

	if (customHeaderCount === 1) {
		return (
			<div className="date-range-calendar__header">
				<div className="react-datepicker__header__dropdown date-range-calendar__month-label">
					{year}
				</div>
				<button
					aria-label="Next Year"
					className="react-datepicker__navigation react-datepicker__navigation--next"
					disabled={nextYearButtonDisabled}
					onClick={increaseYear}
					type="button"
				>
					<span className="react-datepicker__navigation-icon react-datepicker__navigation-icon--next">
						Next Year
					</span>
				</button>
			</div>
		)
	}

	return (
		<div className="date-range-calendar__header">
			<button
				aria-label="Previous Year"
				className="react-datepicker__navigation react-datepicker__navigation--previous"
				disabled={prevYearButtonDisabled}
				onClick={decreaseYear}
				type="button"
			>
				<span className="react-datepicker__navigation-icon react-datepicker__navigation-icon--previous">
					Previous Year
				</span>
			</button>
			<div className="react-datepicker__header__dropdown react-datepicker__header__dropdown--select">
				<div className="react-datepicker__year-dropdown-container react-datepicker__year-dropdown-container--select">
					<select
						className="react-datepicker__year-select"
						onChange={(e) => changeYear(Number(e.target.value))}
						value={year}
					>
						{YEARS.map((y) => (
							<option key={y} value={y}>
								{y}
							</option>
						))}
					</select>
				</div>
			</div>
		</div>
	)
}

interface RangeInputProps {
	appearance: DateRangePickerAppearance
	endDate: Date | null
	locale: string
	onClick?: () => void
	placeholder: string
	startDate: Date | null
}

const formatByAppearance = (
	date: Date | null,
	appearance: DateRangePickerAppearance,
	locale: string
): string => {
	if (!date) return ''
	switch (appearance) {
		case 'dayOnly':
			return date.toLocaleDateString(locale, { month: 'short', day: '2-digit' })
		case 'monthOnly':
			return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
		default:
			return date.toLocaleDateString(locale, { month: '2-digit', day: '2-digit', year: 'numeric' })
	}
}

const RangeInput = forwardRef<HTMLInputElement, RangeInputProps>(
	({ appearance, endDate, locale, onClick, placeholder, startDate }, ref) => {
		const value =
			startDate || endDate
				? `${formatByAppearance(startDate, appearance, locale)} → ${formatByAppearance(endDate, appearance, locale) || '...'}`
				: ''

		return (
			<input
				onChange={() => {}}
				onClick={onClick}
				placeholder={placeholder}
				readOnly
				ref={ref}
				value={value}
			/>
		)
	}
)
RangeInput.displayName = 'RangeInput'

type DateRangeFieldComponentProps = GroupFieldClientProps & DateRangeFieldOptions

const DateRangeFieldComponent = (props: DateRangeFieldComponentProps) => {
	const {
		field: { admin: { className, description } = {}, label },
		path,
		readOnly,
		pickerAppearance = 'default',
		timezone = false,
	} = props

	const { config } = useConfig()
	const { i18n, t } = useTranslation()
	const { dispatchFields, setModified } = useForm()

	const locale = i18n.language

	const fromValue = useFormFields(([fields]) => fields[`${path}.from`]?.value as string | null)
	const toValue = useFormFields(([fields]) => fields[`${path}.to`]?.value as string | null)
	const tzValue = useFormFields(([fields]) =>
		timezone ? (fields[`${path}._tz`]?.value as string | null) : null
	)

	const startDate = fromValue ? new Date(fromValue) : null
	const endDate = toValue ? new Date(toValue) : null
	const hasValue = Boolean(startDate ?? endDate)

	const [pickerKey, setPickerKey] = useState(0)
	const onCalendarClose = useCallback(() => setPickerKey((k) => k + 1), [])

	const onChange = useCallback(
		(dates: [Date | null, Date | null]) => {
			if (readOnly) return
			const [start, end] = dates
			dispatchFields({
				type: 'UPDATE',
				path: `${path}.from`,
				value: normalizeDate(start)?.toISOString() ?? null,
			})
			dispatchFields({
				type: 'UPDATE',
				path: `${path}.to`,
				value: normalizeDate(end)?.toISOString() ?? null,
			})
			setModified(true)
		},
		[path, readOnly, dispatchFields, setModified]
	)

	const onClear = useCallback(() => {
		if (readOnly) return
		dispatchFields({ type: 'UPDATE', path: `${path}.from`, value: null })
		dispatchFields({ type: 'UPDATE', path: `${path}.to`, value: null })
		setModified(true)
	}, [path, readOnly, dispatchFields, setModified])

	const onTimezoneChange = useCallback(
		(tz: string) => {
			dispatchFields({ type: 'UPDATE', path: `${path}._tz`, value: tz })
			setModified(true)
		},
		[path, dispatchFields, setModified]
	)

	const appearanceConfig = APPEARANCE_CONFIG[pickerAppearance]

	const customHeader = useMemo(() => {
		if (pickerAppearance === 'monthOnly') return renderMonthOnlyHeader
		const months = getMonthNames(locale)
		return makeDefaultHeader(months)
	}, [pickerAppearance, locale])

	const supportedTimezones = useMemo(
		() => config.admin.timezones?.supportedTimezones ?? [],
		[config.admin.timezones]
	)

	const style = useMemo(() => mergeFieldStyles(props.field), [props.field])
	return (
		<div
			className={['field-type', baseClass, className, readOnly && 'read-only']
				.filter(Boolean)
				.join(' ')}
			style={style}
		>
			<DateRangeStyles />
			<FieldLabel label={label} path={path} />
			<div className="field-type__wrap" id={`field-${path.replace(/\./g, '__')}`}>
				<FieldError path={path} />
				<div
					className={`${pickerClass} ${pickerClass}__appearance--${pickerAppearance} date-range-picker`}
				>
					<div className={`${pickerClass}__icon-wrap`}>
						{hasValue && !readOnly && (
							<button className={`${pickerClass}__clear-button`} onClick={onClear} type="button">
								<svg
									aria-hidden="true"
									className="icon icon--x"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.5"
									viewBox="0 0 25 25"
									xmlns="http://www.w3.org/2000/svg"
								>
									<line x1="6" x2="19" y1="6" y2="19" />
									<line x1="19" x2="6" y1="6" y2="19" />
								</svg>
							</button>
						)}
						<svg
							aria-hidden="true"
							className="icon icon--calendar"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							viewBox="0 0 25 25"
							xmlns="http://www.w3.org/2000/svg"
						>
							<rect height="18" rx="1" width="18" x="3.5" y="4.5" />
							<line x1="16" x2="16" y1="3" y2="6" />
							<line x1="9" x2="9" y1="3" y2="6" />
							<line x1="3.5" x2="21.5" y1="9.5" y2="9.5" />
						</svg>
					</div>
					<div className={`${pickerClass}__input-wrapper`}>
						<ReactDatePicker
							calendarClassName="date-range-calendar"
							customInput={
								<RangeInput
									appearance={pickerAppearance}
									endDate={endDate}
									locale={locale}
									placeholder={t(keys.dateRangePlaceholder)}
									startDate={startDate}
								/>
							}
							disabled={readOnly}
							endDate={endDate ?? undefined}
							key={pickerKey}
							monthsShown={2}
							onCalendarClose={onCalendarClose}
							onChange={onChange as (dates: [Date | null, Date | null]) => void}
							openToDate={startDate ?? undefined}
							popperPlacement="bottom-start"
							renderCustomHeader={customHeader}
							selectsRange
							selected={startDate}
							showPopperArrow={false}
							startDate={startDate ?? undefined}
							{...appearanceConfig}
						/>
					</div>
				</div>
				{timezone && supportedTimezones.length > 0 && (
					<TimezonePicker
						id={`${path}-timezone-picker`}
						onChange={onTimezoneChange}
						options={supportedTimezones}
						readOnly={readOnly}
						selectedTimezone={tzValue ?? undefined}
					/>
				)}
				<FieldDescription description={description} path={path} />
			</div>
		</div>
	)
}

export const DateRangeField = withCondition(DateRangeFieldComponent)
