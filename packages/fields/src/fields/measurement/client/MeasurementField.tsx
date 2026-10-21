'use client'
import { useField } from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { NumberFieldClientProps, Validate } from 'payload'
import { number } from 'payload/shared'
import type React from 'react'
import { useCallback, useMemo } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import type { MeasurementResolvedClientOptions } from '../options'
import { MeasurementInputView } from './MeasurementInput'
import { useMeasurementModel } from './useMeasurementModel'

export type MeasurementFieldProps = {
	measurementOptions: MeasurementResolvedClientOptions
} & NumberFieldClientProps

/** The measurement row bound to the document form through `useField`, with unit-aware bound messages. */
export const MeasurementField: React.FC<MeasurementFieldProps> = (props) => {
	const {
		field,
		field: {
			admin: { className, description, placeholder, readOnly: readOnlyFromAdmin } = {},
			label,
			localized,
			max,
			min,
			name,
			required,
		},
		measurementOptions,
		path: pathFromProps,
		readOnly: readOnlyFromProps,
	} = props
	const { t } = useTranslation()
	const model = useMeasurementModel(measurementOptions)
	const { fmtBound } = model

	const memoizedValidate = useCallback<Validate<number | null | undefined>>(
		(value, options) => {
			if (typeof value === 'number' && !Number.isNaN(value)) {
				if (typeof min === 'number' && value < min) {
					return t(keys.measurementBelowMin, { min: fmtBound(min) })
				}
				if (typeof max === 'number' && value > max) {
					return t(keys.measurementAboveMax, { max: fmtBound(max) })
				}
			}
			return number(value, {
				...options,
				max: undefined,
				min: undefined,
				name,
				required,
				type: 'number',
			} as Parameters<typeof number>[1])
		},
		[fmtBound, max, min, name, required, t]
	)

	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<number | null>({ potentiallyStalePath: pathFromProps, validate: memoizedValidate })

	// renderField only maps permissions into the readOnly clientProp; admin.readOnly
	// reaches custom Field components solely via clientField.admin
	const isReadOnly = Boolean(readOnlyFromProps || disabled || readOnlyFromAdmin)
	const styles = useMemo(() => mergeFieldStyles(field), [field])

	return (
		<MeasurementInputView
			AfterInput={AfterInput}
			BeforeInput={BeforeInput}
			className={className}
			Description={Description}
			description={description}
			Error={ErrorComponent}
			Label={Label}
			label={label}
			localized={localized}
			max={max}
			min={min}
			model={model}
			onChange={setValue}
			path={path}
			placeholder={typeof placeholder === 'string' ? placeholder : undefined}
			readOnly={isReadOnly}
			required={required}
			showError={showError}
			style={styles}
			value={value}
		/>
	)
}
