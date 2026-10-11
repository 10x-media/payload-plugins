'use client'

import { useField, useFormFields, withCondition } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { isDimensionKey, isFilterOperator } from '../../core/guards'
import { siblingPath } from '../../goals/amountField'
import { FILTER_OPERATOR_KEYS } from '../../translations/metricKeys'
import { useTranslation } from '../../translations/useTranslation'
import { FilterKeySelect, filterNotice, keyOptions } from './FilterKeySelect'
import { useFilterCapabilities } from './useFilterCapabilities'

/** @beta */
export type FilterOperatorSelectFieldProps = TextFieldClientProps & {
	/**
	 * Path of the sibling source select this picker narrows against, for custom widgets
	 * whose source field is named differently. Defaults to `'dataSource'`.
	 */
	sourceFieldPath?: string
	/**
	 * Path of the dimension picker this operator belongs to. Defaults to the sibling named
	 * `dimension`, which is where the built-in filter group keeps it.
	 */
	dimensionFieldPath?: string
}

/**
 * Offers only operators the chosen source takes for the chosen dimension. Not clearable: a filter
 * always compares somehow, and the dimension is what turns it off.
 */
const FilterOperatorSelectFieldComponent = (props: FilterOperatorSelectFieldProps) => {
	const { dimensionFieldPath, field, path: pathFromProps, readOnly, sourceFieldPath } = props
	const { t } = useTranslation()
	const {
		error,
		operators: anyOperators,
		operatorsFor,
		resolved,
	} = useFilterCapabilities(sourceFieldPath)
	const fieldState = useField<string>({ potentiallyStalePath: pathFromProps })
	const stored = fieldState.value
	const dimension = useFormFields(([fields]) => {
		const picked = fields?.[dimensionFieldPath ?? siblingPath(fieldState.path, 'dimension')]?.value
		return isDimensionKey(picked) ? picked : undefined
	})
	const operators = useMemo(
		() => (dimension === undefined ? anyOperators : operatorsFor(dimension)),
		[anyOperators, dimension, operatorsFor]
	)
	const options = useMemo(
		() =>
			keyOptions({
				offered: operators,
				stored,
				isKey: isFilterOperator,
				labelOf: (operator) => t(FILTER_OPERATOR_KEYS[operator]),
			}),
		[operators, t, stored]
	)

	return (
		<FilterKeySelect
			field={field}
			fieldState={fieldState}
			isClearable={false}
			notice={filterNotice(t, { error, resolved, offered: operators.length })}
			options={options}
			readOnly={readOnly}
		/>
	)
}

/** @beta */
export const FilterOperatorSelectField = withCondition(FilterOperatorSelectFieldComponent)
