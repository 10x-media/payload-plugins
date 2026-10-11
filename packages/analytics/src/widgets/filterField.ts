import type { NamedGroupField, TextFieldSingleValidation } from 'payload'
import { type AnalyticsFilter, DIMENSION_KEYS, FILTER_OPERATORS } from '../core/contract'
import { isRecord } from '../core/values'
import { MAX_QUERY_FILTER_VALUE_LENGTH } from '../query/limits'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { THIRD } from './fieldRows'
import type { WidgetFilter } from './types'

/** importMap paths of the scoped pickers; the factory never imports the components. */
export const FILTER_DIMENSION_COMPONENT =
	'@10x-media/analytics/rsc#FilterDimensionSelectFieldServer'
export const FILTER_OPERATOR_COMPONENT = '@10x-media/analytics/rsc#FilterOperatorSelectFieldServer'
export const FILTER_VALUE_COMPONENT = '@10x-media/analytics/rsc#FilterValueFieldServer'

/**
 * The dimension is the gate: without one there is no filter, so an empty value is fine.
 * With one, a blank value would filter on nothing and read as an accident.
 */
const validateValue: TextFieldSingleValidation = (value, { req, siblingData }) => {
	const dimension = isRecord(siblingData) ? siblingData.dimension : undefined
	if (typeof dimension !== 'string' || dimension.trim() === '') return true
	const trimmed = typeof value === 'string' ? value.trim() : ''
	if (trimmed === '') return asTranslate(req.t)(keys.widgetFilterValueRequired)
	return trimmed.length <= MAX_QUERY_FILTER_VALUE_LENGTH
		? true
		: asTranslate(req.t)(keys.widgetFilterValueTooLong)
}

/**
 * The stored group as zero or one query filter; the value is stored as typed, so it is trimmed
 * and capped here. An unknown dimension is no filter; an unknown operator becomes `eq`.
 *
 * @beta
 */
export const widgetFilters = (data: { filter?: WidgetFilter }): AnalyticsFilter[] => {
	const { dimension, operator, value } = data.filter ?? {}
	const trimmed = typeof value === 'string' ? value.trim() : ''
	if (!dimension || !DIMENSION_KEYS.includes(dimension) || trimmed === '') {
		return []
	}
	return [
		{
			dimension,
			operator: operator && FILTER_OPERATORS.includes(operator) ? operator : 'eq',
			value: trimmed.slice(0, MAX_QUERY_FILTER_VALUE_LENGTH),
		},
	]
}

/**
 * Optional one-filter group every filterable widget carries. Text- rather than select-backed:
 * servable dimensions and operators vary per source and request, so client pickers list them.
 */
export const filterField = (): NamedGroupField => ({
	name: 'filter',
	type: 'group',
	label: labelForKey(keys.widgetFieldFilter),
	admin: { description: labelForKey(keys.widgetFieldFilterDescription) },
	fields: [
		{
			// A row carries no name, so the three keep their `filter.<name>` paths.
			type: 'row',
			fields: [
				{
					name: 'dimension',
					type: 'text',
					label: labelForKey(keys.widgetFieldFilterDimension),
					admin: { width: THIRD, components: { Field: { path: FILTER_DIMENSION_COMPONENT } } },
				},
				{
					name: 'operator',
					type: 'text',
					defaultValue: 'eq',
					label: labelForKey(keys.widgetFieldFilterOperator),
					admin: { width: THIRD, components: { Field: { path: FILTER_OPERATOR_COMPONENT } } },
				},
				{
					name: 'value',
					type: 'text',
					maxLength: MAX_QUERY_FILTER_VALUE_LENGTH,
					label: labelForKey(keys.widgetFieldFilterValue),
					validate: validateValue,
					admin: { width: THIRD, components: { Field: { path: FILTER_VALUE_COMPONENT } } },
				},
			],
		},
	],
})
