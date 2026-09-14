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
import { DIMENSION_KEYS, type DimensionKey } from '../../core/contract'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { DIMENSION_LABELS } from '../../view/labels'
import { useFilterCapabilities } from './useFilterCapabilities'

export type FilterDimensionSelectFieldProps = TextFieldClientProps & {
	/**
	 * Path of the sibling source select this picker narrows against, for custom widgets
	 * whose source field is named differently. Defaults to `'dataSource'`.
	 */
	sourceFieldPath?: string
}

const asDimension = (value: string): DimensionKey | undefined =>
	DIMENSION_KEYS.find((key) => key === value)

/**
 * Dimension picker for a widget's filter group: offers only the dimensions the widget's
 * chosen source can filter by, unioned over the request's sources while none is chosen.
 * A stored dimension the source dropped stays in the list so it reads as the filter it is
 * and can be cleared; the read path renders the unsupported state for it either way.
 * While the source list is in flight the picker offers nothing rather than a wrong list,
 * and says so once it settles empty or failed.
 */
const FilterDimensionSelectFieldComponent = (props: FilterDimensionSelectFieldProps) => {
	const { field, path: pathFromProps, readOnly, sourceFieldPath } = props
	const { t } = useTranslation()
	const { dimensions, error, loading } = useFilterCapabilities(sourceFieldPath)
	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string>({ potentiallyStalePath: pathFromProps })

	const options = useMemo(() => {
		const offered = dimensions.map((key) => ({ label: t(DIMENSION_LABELS[key]), value: key }))
		if (!value || dimensions.some((key) => key === value)) return offered
		const known = asDimension(value)
		return [{ label: known ? t(DIMENSION_LABELS[known]) : value, value }, ...offered]
	}, [dimensions, t, value])
	const style = useMemo(() => mergeFieldStyles(field), [field])

	const notice = error
		? t(keys.fieldFilterError)
		: !loading && dimensions.length === 0
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
			isClearable
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

export const FilterDimensionSelectField = withCondition(FilterDimensionSelectFieldComponent)
