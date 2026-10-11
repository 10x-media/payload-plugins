import type { SelectFieldServerProps, TextFieldServerProps } from 'payload'
import { clientFieldProps } from '../../ui/data/clientFieldProps'
import { WithScopeToken } from '../../ui/data/WithScopeToken'
import {
	FilterDimensionSelectField,
	type FilterDimensionSelectFieldProps,
} from './FilterDimensionSelectField'
import {
	FilterOperatorSelectField,
	type FilterOperatorSelectFieldProps,
} from './FilterOperatorSelectField'
import { FilterValueField, type FilterValueFieldProps } from './FilterValueField'
import { MetricSelectField, type MetricSelectFieldProps } from './MetricSelectField'
import { SourceSelectField } from './SourceSelectField'

// Each picker reads the scope-keyed source list (value field: its suggestions too), keyed by the
// scope token resolved from the `req` a field server component gets (`ServerFieldBase`).

/**
 * The data source picker of a widget's drawer, keyed by the server's scope token.
 *
 * @beta
 */
export function SourceSelectFieldServer(props: SelectFieldServerProps) {
	return (
		<WithScopeToken req={props.req}>
			<SourceSelectField {...clientFieldProps(props)} />
		</WithScopeToken>
	)
}

/**
 * The metric picker of a widget's drawer, keyed by the server's scope token.
 *
 * @beta
 */
export function MetricSelectFieldServer(
	props: SelectFieldServerProps & Pick<MetricSelectFieldProps, 'requires' | 'sourceFieldPath'>
) {
	return (
		<WithScopeToken req={props.req}>
			<MetricSelectField {...clientFieldProps(props)} />
		</WithScopeToken>
	)
}

/**
 * The filter dimension picker of a widget's drawer, keyed by the server's scope token.
 *
 * @beta
 */
export function FilterDimensionSelectFieldServer(
	props: TextFieldServerProps & Pick<FilterDimensionSelectFieldProps, 'sourceFieldPath'>
) {
	return (
		<WithScopeToken req={props.req}>
			<FilterDimensionSelectField {...clientFieldProps(props)} />
		</WithScopeToken>
	)
}

/**
 * The filter operator picker of a widget's drawer, keyed by the server's scope token.
 *
 * @beta
 */
export function FilterOperatorSelectFieldServer(
	props: TextFieldServerProps &
		Pick<FilterOperatorSelectFieldProps, 'sourceFieldPath' | 'dimensionFieldPath'>
) {
	return (
		<WithScopeToken req={props.req}>
			<FilterOperatorSelectField {...clientFieldProps(props)} />
		</WithScopeToken>
	)
}

/**
 * The filter value field of a widget's drawer, its suggestions keyed by the server's scope token.
 *
 * @beta
 */
export function FilterValueFieldServer(
	props: TextFieldServerProps &
		Pick<FilterValueFieldProps, 'sourceFieldPath' | 'dimensionFieldPath' | 'operatorFieldPath'>
) {
	return (
		<WithScopeToken req={props.req}>
			<FilterValueField {...clientFieldProps(props)} />
		</WithScopeToken>
	)
}
