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

const normalizeOne = (
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
export const normalizeFormConditions = (
	fields: FieldRow[],
	conditionTypes: Record<string, ConditionFieldType>
): FieldRow[] => {
	const operandTypes = new Map<string, ConditionFieldType>()
	for (const row of fields) {
		const name = typeof row.name === 'string' ? row.name.trim() : ''
		// A type absent from the map is not conditionable (display-only, e.g. message): constraints
		// referencing it are stripped, matching the client operand list.
		const conditionType = conditionTypes[row.blockType]
		if (name.length > 0 && conditionType) {
			operandTypes.set(name, conditionType)
		}
	}
	return fields.map((row) => {
		const visibleWhen = normalizeOne(row.visibleWhen, operandTypes)
		const validateWhen = normalizeOne(row.validateWhen, operandTypes)
		return { ...row, visibleWhen, validateWhen }
	})
}
