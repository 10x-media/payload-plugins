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
import { useCallback, useId, useMemo } from 'react'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { shownBound, storedBound } from '../../ui/calendarDays'
import { RangePicker } from '../../ui/RangePicker'
import { viewerNow } from '../../ui/viewerClock'
import type { DateRangeFieldOptions } from './types'
import '../../ui/analytics.css'

/** @internal */
export type DateRangeFieldComponentProps = GroupFieldClientProps & DateRangeFieldOptions

const storedText = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * Range picker over the group's hidden `from`/`to` dates. Each bound is stored at its day's UTC
 * midnight, so a reader counts the picked day wherever the admin sat.
 */
const DateRangeFieldComponent = (props: DateRangeFieldComponentProps) => {
	const {
		field: { admin: { className, description } = {}, label },
		path,
		readOnly,
		pickerAppearance = 'default',
		timezone = false,
		untilToday = false,
	} = props

	const { config } = useConfig()
	const { t } = useTranslation()
	const { dispatchFields, setModified } = useForm()
	const inputId = useId()

	const fromValue = useFormFields(([fields]) => storedText(fields[`${path}.from`]?.value))
	const toValue = useFormFields(([fields]) => storedText(fields[`${path}.to`]?.value))
	const tzValue = useFormFields(([fields]) =>
		timezone ? storedText(fields[`${path}._tz`]?.value) : null
	)

	const onChange = useCallback(
		(start: Date | null, end: Date | null) => {
			if (readOnly) return
			dispatchFields({ type: 'UPDATE', path: `${path}.from`, value: storedBound(start) })
			dispatchFields({ type: 'UPDATE', path: `${path}.to`, value: storedBound(end) })
			setModified(true)
		},
		[path, readOnly, dispatchFields, setModified]
	)

	const onTimezoneChange = useCallback(
		(tz: string) => {
			dispatchFields({ type: 'UPDATE', path: `${path}._tz`, value: tz })
			setModified(true)
		},
		[path, dispatchFields, setModified]
	)

	const supportedTimezones = useMemo(
		() => config.admin.timezones?.supportedTimezones ?? [],
		[config.admin.timezones]
	)

	const style = useMemo(() => mergeFieldStyles(props.field), [props.field])
	const now = viewerNow()
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	return (
		<div
			className={[
				'field-type',
				'date-time-field',
				'analytics-date-range',
				className,
				readOnly && 'read-only',
			]
				.filter(Boolean)
				.join(' ')}
			style={style}
		>
			<FieldLabel htmlFor={inputId} label={label} path={path} />
			<div className="field-type__wrap" id={`field-${path.replace(/\./g, '__')}`}>
				<FieldError path={path} />
				<RangePicker
					appearance={pickerAppearance}
					clearable
					end={shownBound(toValue)}
					inputId={inputId}
					{...(untilToday ? { maxDate: today } : {})}
					onChange={onChange}
					placeholder={t(keys.dateRangePlaceholder)}
					readOnly={Boolean(readOnly)}
					start={shownBound(fromValue)}
				/>
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

/** @internal */
export const DateRangeField = withCondition(DateRangeFieldComponent)
