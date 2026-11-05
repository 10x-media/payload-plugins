'use client'

import { useField, withCondition } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { useMemo } from 'react'
import { isDimensionKey } from '../../core/guards'
import { useTranslation } from '../../translations/useTranslation'
import { DIMENSION_LABELS } from '../../view/labels'
import { FilterKeySelect, filterNotice, keyOptions } from './FilterKeySelect'
import { useFilterCapabilities } from './useFilterCapabilities'

/** @beta */
export type FilterDimensionSelectFieldProps = TextFieldClientProps & {
	/**
	 * Path of the sibling source select this picker narrows against, for custom widgets
	 * whose source field is named differently. Defaults to `'dataSource'`.
	 */
	sourceFieldPath?: string
}

/**
 * Offers only dimensions the chosen source can filter by (union over sources while none is
 * chosen). A stored dimension the source dropped stays listed so it can be cleared.
 */
const FilterDimensionSelectFieldComponent = (props: FilterDimensionSelectFieldProps) => {
	const { field, path: pathFromProps, readOnly, sourceFieldPath } = props
	const { t } = useTranslation()
	const { dimensions, error, resolved } = useFilterCapabilities(sourceFieldPath)
	const fieldState = useField<string>({ potentiallyStalePath: pathFromProps })
	const stored = fieldState.value
	const options = useMemo(
		() =>
			keyOptions({
				offered: dimensions,
				stored,
				isKey: isDimensionKey,
				labelOf: (key) => t(DIMENSION_LABELS[key]),
			}),
		[dimensions, t, stored]
	)

	return (
		<FilterKeySelect
			field={field}
			fieldState={fieldState}
			isClearable
			notice={filterNotice(t, { error, resolved, offered: dimensions.length })}
			options={options}
			readOnly={readOnly}
		/>
	)
}

/** @beta */
export const FilterDimensionSelectField = withCondition(FilterDimensionSelectFieldComponent)
