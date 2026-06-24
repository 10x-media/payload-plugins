import type { Operator } from 'payload'
import type { FormFieldValueKind } from '../fields/types'

/**
 * The condition input families the builder supports. A deliberate subset of Payload's field-condition
 * types, restricted to the operators `evaluateCondition` implements (no geo/relationship in v1).
 */
export type ConditionFieldType = 'text' | 'number' | 'select' | 'checkbox' | 'date'

const EQUALITY: Operator[] = ['equals', 'not_equals']
const MEMBERSHIP: Operator[] = ['in', 'not_in']
const ORDER: Operator[] = ['greater_than', 'greater_than_equal', 'less_than', 'less_than_equal']
const TEXT_MATCH: Operator[] = ['like', 'not_like', 'contains']
const EXISTS: Operator[] = ['exists']

/** Operators offered per condition type. Each is implemented by `evaluateCondition`. */
export const conditionOperators: Record<ConditionFieldType, Operator[]> = {
	text: [...EQUALITY, ...MEMBERSHIP, ...TEXT_MATCH, ...EXISTS],
	number: [...EQUALITY, ...MEMBERSHIP, ...ORDER, ...EXISTS],
	select: [...EQUALITY, ...MEMBERSHIP, ...EXISTS],
	checkbox: [...EQUALITY, ...EXISTS],
	date: [...EQUALITY, ...ORDER, ...EXISTS],
}

/** Default condition input for a stored value kind; a field type may override via its `conditionType`. */
export const defaultConditionType = (value: FormFieldValueKind): ConditionFieldType => {
	switch (value) {
		case 'number':
			return 'number'
		case 'boolean':
			return 'checkbox'
		case 'date':
			return 'date'
		case 'text[]':
			return 'select'
		default:
			return 'text'
	}
}

/**
 * The Payload `operators:*` i18n keys the builder uses for operator labels. A local literal union (not
 * imported from `@payloadcms/translations`, which this package never depends on); each member is a real
 * client translation key, so a value of this type is accepted by Payload's `i18n.t`.
 */
export type OperatorLabelKey =
	| 'operators:contains'
	| 'operators:equals'
	| 'operators:exists'
	| 'operators:isGreaterThan'
	| 'operators:isGreaterThanOrEqualTo'
	| 'operators:isIn'
	| 'operators:isLessThan'
	| 'operators:isLessThanOrEqualTo'
	| 'operators:isLike'
	| 'operators:isNotEqualTo'
	| 'operators:isNotIn'
	| 'operators:isNotLike'

const OPERATOR_LABEL_KEYS: Partial<Record<Operator, OperatorLabelKey>> = {
	equals: 'operators:equals',
	not_equals: 'operators:isNotEqualTo',
	in: 'operators:isIn',
	not_in: 'operators:isNotIn',
	exists: 'operators:exists',
	greater_than: 'operators:isGreaterThan',
	greater_than_equal: 'operators:isGreaterThanOrEqualTo',
	less_than: 'operators:isLessThan',
	less_than_equal: 'operators:isLessThanOrEqualTo',
	like: 'operators:isLike',
	not_like: 'operators:isNotLike',
	contains: 'operators:contains',
}

/**
 * The i18n key for an operator's label, in Payload's own `operators:*` namespace (always present in the
 * admin), so the builder reads native, localized operator labels without duplicating them in our i18n.
 * Keys mirror Payload's `WhereBuilder/field-types.tsx` operator labels. Every operator surfaced by
 * `conditionOperators` is mapped; the `operators:equals` fallback is unreachable for the offered
 * catalogs (no geo/`all` operator is ever presented) and exists only to keep the return type total.
 */
export const operatorLabelKey = (operator: Operator): OperatorLabelKey =>
	OPERATOR_LABEL_KEYS[operator] ?? 'operators:equals'

/**
 * The first (default) operator a condition type offers. Every catalog leads with `equals`, so the
 * fallback is unreachable; it exists only to keep the return non-optional under `noUncheckedIndexedAccess`.
 */
export const firstOperatorFor = (type: ConditionFieldType): Operator =>
	conditionOperators[type][0] ?? 'equals'

/** The value control an operator needs: a boolean toggle (`exists`), a list (`in`/`not_in`), or a scalar. */
export const operatorValueShape = (operator: Operator): 'boolean' | 'array' | 'scalar' => {
	if (operator === 'exists') {
		return 'boolean'
	}
	if (operator === 'in' || operator === 'not_in') {
		return 'array'
	}
	return 'scalar'
}
