'use client'

import {
	FieldDescription,
	type ReactSelectOption,
	SelectInput,
	useField,
	withCondition,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import type { TextFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { FILTER_OPERATORS, type FilterOperator } from '../../core/contract'
import { keys } from '../../translations/keys'
import { FILTER_OPERATOR_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { useFilterCapabilities } from './useFilterCapabilities'

export type FilterOperatorSelectFieldProps = TextFieldClientProps & {
	/**
	 * Path of the sibling source select this picker narrows against, for custom widgets
	 * whose source field is named differently. Defaults to `'dataSource'`.
	 */
	sourceFieldPath?: string
}

const asOperator = (value: string): FilterOperator | undefined =>
	FILTER_OPERATORS.find((op) => op === value)

/**
 * Operator picker for a widget's filter group: offers only the operators the widget's
 * chosen source supports, unioned over the request's sources while none is chosen. It is
 * not clearable, because a filter always compares somehow; the dimension is the gate that
 * turns the filter off.
 */
const FilterOperatorSelectFieldComponent = (props: FilterOperatorSelectFieldProps) => {
	const { field, path: pathFromProps, readOnly, sourceFieldPath } = props
	const { t } = useTranslation()
	const { error, operators, resolved } = useFilterCapabilities(sourceFieldPath)
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string>({ potentiallyStalePath: pathFromProps })

	const options = useMemo(() => {
		const offered = operators.map((op) => ({ label: t(FILTER_OPERATOR_KEYS[op]), value: op }))
		if (!value || operators.some((op) => op === value)) return offered
		const known = asOperator(value)
		return [{ label: known ? t(FILTER_OPERATOR_KEYS[known]) : value, value }, ...offered]
	}, [operators, t, value])
	const style = useMemo(() => mergeFieldStyles(field), [field])

	const notice = error
		? t(keys.fieldFilterError)
		: resolved && operators.length === 0
			? t(keys.fieldFilterEmpty)
			: null

	return (
		<SelectInput
			AfterInput={AfterInput}
			BeforeInput={BeforeInput}
			className={field.admin?.className}
			Description={
				notice ? (
					<>
						{Description ?? <FieldDescription description={field.admin?.description} path={path} />}
						<div className="field-description">{notice}</div>
					</>
				) : (
					Description
				)
			}
			description={field.admin?.description}
			Error={ErrorComponent}
			isClearable={false}
			Label={Label}
			label={field.label}
			name={field.name}
			onChange={(selected: ReactSelectOption | ReactSelectOption[]) => {
				const option = Array.isArray(selected) ? selected[0] : selected
				setValue(option?.value ? String(option.value) : null)
			}}
			options={options}
			path={path}
			readOnly={readOnly || disabled || field.admin?.readOnly}
			showError={showError}
			style={style}
			value={value}
		/>
	)
}

export const FilterOperatorSelectField = withCondition(FilterOperatorSelectFieldComponent)
