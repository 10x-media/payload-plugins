import type { NamedGroupField, TextFieldSingleValidation } from 'payload'
import { MAX_QUERY_FILTER_VALUE_LENGTH } from '../query/limits'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'

/** importMap paths of the scoped pickers; the factory never imports the components. */
export const FILTER_DIMENSION_COMPONENT = '@10x-media/analytics/client#FilterDimensionSelectField'
export const FILTER_OPERATOR_COMPONENT = '@10x-media/analytics/client#FilterOperatorSelectField'

/**
 * The dimension is the gate: without one there is no filter, so an empty value is fine.
 * With one, a blank value would filter on nothing and read as an accident.
 */
const validateValue: TextFieldSingleValidation = (value, { req, siblingData }) => {
	const dimension = (siblingData as { dimension?: unknown } | undefined)?.dimension
	if (typeof dimension !== 'string' || dimension.trim() === '') return true
	const trimmed = typeof value === 'string' ? value.trim() : ''
	if (trimmed === '') return asTranslate(req.t)(keys.widgetFilterValueRequired)
	return trimmed.length <= MAX_QUERY_FILTER_VALUE_LENGTH
		? true
		: asTranslate(req.t)(keys.widgetFilterValueTooLong)
}

/**
 * The optional one-filter group every filterable widget carries. Text-backed rather than
 * select-backed on purpose: the servable dimensions and operators are per source and per
 * request, so the option lists are the client pickers' to build, not the config's.
 */
export const filterField = (): NamedGroupField => ({
	name: 'filter',
	type: 'group',
	label: labelForKey(keys.widgetFieldFilter),
	admin: { description: labelForKey(keys.widgetFieldFilterDescription) },
	fields: [
		{
			name: 'dimension',
			type: 'text',
			label: labelForKey(keys.widgetFieldFilterDimension),
			admin: { components: { Field: { path: FILTER_DIMENSION_COMPONENT } } },
		},
		{
			name: 'operator',
			type: 'text',
			defaultValue: 'eq',
			label: labelForKey(keys.widgetFieldFilterOperator),
			admin: { components: { Field: { path: FILTER_OPERATOR_COMPONENT } } },
		},
		{
			name: 'value',
			type: 'text',
			maxLength: MAX_QUERY_FILTER_VALUE_LENGTH,
			label: labelForKey(keys.widgetFieldFilterValue),
			validate: validateValue,
		},
	],
})
