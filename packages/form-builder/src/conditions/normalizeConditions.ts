import type { Where } from 'payload'
import { transformWhereQuery } from 'payload/shared'
import type { ConditionFieldType } from './fieldTypes'
import { conditionOperators } from './fieldTypes'

export type FieldRow = {
	blockType: string
	name?: string
	visibleWhen?: unknown
	validateWhen?: unknown
	[key: string]: unknown
}

const isValidConstraint = (
	constraint: unknown,
	operandTypes: Map<string, ConditionFieldType>
): boolean => {
	if (constraint == null || typeof constraint !== 'object') {
		return false
	}
	const field = Object.keys(constraint as object)[0]
	if (!field) {
		return false
	}
	const type = operandTypes.get(field)
	if (!type) {
		return false
	}
	const ops = (constraint as Record<string, unknown>)[field]
	if (ops == null || typeof ops !== 'object') {
		return false
	}
	const operator = Object.keys(ops as object)[0]
	return Boolean(operator && (conditionOperators[type] as readonly string[]).includes(operator))
}

/**
 * Canonicalize a `Where` to OR-of-ANDs and strip constraints whose operand field is unknown or whose
 * operator is invalid for that field's condition type. Returns undefined when nothing valid remains.
 */
export const normalizeWhere = (
	raw: unknown,
	operandTypes: Map<string, ConditionFieldType>
): Where | undefined => {
	if (raw == null || typeof raw !== 'object' || Object.keys(raw as object).length === 0) {
		return undefined
	}
	const canonical = transformWhereQuery(raw as Where)
	const or = Array.isArray(canonical.or)
		? canonical.or
		: Array.isArray(canonical.and)
			? [{ and: canonical.and }]
			: []
	const groups = or
		.map((group) => {
			const and = Array.isArray((group as Where).and) ? ((group as Where).and as unknown[]) : []
			return and.filter((constraint) => isValidConstraint(constraint, operandTypes))
		})
		.filter((group) => group.length > 0)
	return groups.length > 0 ? ({ or: groups.map((and) => ({ and })) } as Where) : undefined
}

/**
 * Normalize every field's `visibleWhen`/`validateWhen` against the form's own field list. Canonicalizes
 * to OR-of-ANDs and strips constraints whose operand field is missing or whose operator is invalid for
 * that field's condition type, so stored conditions always match what `evaluateCondition` can run.
 */
/**
 * The operand-name -> condition-type map for a form's fields. A field is a valid condition operand
 * only when it has a name and its block type has a condition type (display-only types are excluded),
 * so a constraint referencing anything else is stripped, matching the client operand list.
 */
export const buildOperandTypes = (
	fields: FieldRow[],
	conditionTypes: Record<string, ConditionFieldType>
): Map<string, ConditionFieldType> => {
	const operandTypes = new Map<string, ConditionFieldType>()
	for (const row of fields) {
		const name = typeof row.name === 'string' ? row.name.trim() : ''
		const conditionType = conditionTypes[row.blockType]
		if (name.length > 0 && conditionType) {
			operandTypes.set(name, conditionType)
		}
	}
	return operandTypes
}

export const normalizeFormConditions = (
	fields: FieldRow[],
	conditionTypes: Record<string, ConditionFieldType>
): FieldRow[] => {
	const operandTypes = buildOperandTypes(fields, conditionTypes)
	return fields.map((row) => {
		const visibleWhen = normalizeWhere(row.visibleWhen, operandTypes)
		const validateWhen = normalizeWhere(row.validateWhen, operandTypes)
		return { ...row, visibleWhen, validateWhen }
	})
}
