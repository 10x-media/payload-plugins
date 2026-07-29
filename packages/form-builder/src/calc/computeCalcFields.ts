import { isNamedField } from '../fields/fieldKey'
import type { FormFieldInstance } from '../submissions/types'
import { type CalcResolved, evaluateCalc } from './evaluate'
import type { CalcExpression } from './types'

/** Returns the calc expression if the field carries one (non-null object), otherwise undefined. */
export const calcExpressionOf = (field: FormFieldInstance): CalcExpression | undefined => {
	const expr = field.expression
	return expr !== null && typeof expr === 'object' && !Array.isArray(expr)
		? (expr as CalcExpression)
		: undefined
}

/**
 * Returns answers with every calc field's value derived from its expression,
 * folded in declaration order so a calc may reference an earlier calc's result.
 * Identity when no field carries an expression. `resolved` threads server-resolved
 * source values, weight maps, and custom functions into each evaluation.
 */
export const computeCalcFields = (
	fields: FormFieldInstance[],
	answers: Record<string, unknown>,
	resolved?: CalcResolved
): Record<string, unknown> => {
	let next = answers
	for (const field of fields) {
		const expr = calcExpressionOf(field)
		if (expr && isNamedField(field)) {
			next = { ...next, [field.name]: evaluateCalc(expr, next, resolved) }
		}
	}
	return next
}
