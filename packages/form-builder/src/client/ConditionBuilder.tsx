'use client'

import { useFormFields } from '@payloadcms/ui'
import type { Operator, Where } from 'payload'
import { reduceFieldsToValues, transformWhereQuery } from 'payload/shared'
import { useMemo } from 'react'
import { type ConditionFieldType, firstOperatorFor } from '../conditions/fieldTypes'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import { ConditionRow, type RowCondition } from './ConditionRow'
import { type ConditionOperand, type FieldRow, operandFromRow } from './synthesizeClientField'

export type ConditionBuilderProps = {
	value?: Where
	onChange: (next: Where) => void
	conditionTypes: Record<string, ConditionFieldType>
	/** This field's own machine name, excluded from the operand list (a field cannot condition on itself). */
	selfName?: string
}

const toRow = (constraint: Record<string, unknown>): RowCondition | null => {
	const field = Object.keys(constraint)[0]
	if (!field) {
		return null
	}
	const ops = constraint[field] as Record<string, unknown>
	const operator = Object.keys(ops)[0] as Operator | undefined
	if (!operator) {
		return null
	}
	return { field, operator, value: ops[operator] }
}

const fromRow = (row: RowCondition): Where => ({ [row.field]: { [row.operator]: row.value } })

const readGroups = (value: Where | undefined): RowCondition[][] => {
	if (!value || Object.keys(value).length === 0) {
		return []
	}
	const canonical = transformWhereQuery(value)
	const or = Array.isArray(canonical.or) ? canonical.or : []
	return or.map((group) => {
		const and = Array.isArray((group as Where).and) ? ((group as Where).and as Where[]) : []
		return and
			.map((constraint) => toRow(constraint as Record<string, unknown>))
			.filter((row): row is RowCondition => row !== null)
	})
}

const writeGroups = (groups: RowCondition[][]): Where => ({
	or: groups.filter((group) => group.length > 0).map((group) => ({ and: group.map(fromRow) })),
})

const operandsFromData = (
	data: Record<string, unknown>,
	conditionTypes: Record<string, ConditionFieldType>,
	selfName: string | undefined
): ConditionOperand[] => {
	const rows = Array.isArray(data.fields) ? (data.fields as FieldRow[]) : []
	return rows
		.map((row) => operandFromRow(row, conditionTypes))
		.filter((operand): operand is ConditionOperand => operand !== null && operand.name !== selfName)
}

export const ConditionBuilder = ({
	value,
	onChange,
	conditionTypes,
	selfName,
}: ConditionBuilderProps) => {
	const { t } = useTranslation()
	// Serialize the operand list so the builder re-renders only when operands actually change (a field
	// added, renamed, retyped, or its options edited), not on every unrelated form-state update.
	const operandsJson = useFormFields(([fields]) =>
		JSON.stringify(operandsFromData(reduceFieldsToValues(fields, true), conditionTypes, selfName))
	)
	const operands = useMemo(() => JSON.parse(operandsJson) as ConditionOperand[], [operandsJson])

	const groups = readGroups(value)
	const emit = (next: RowCondition[][]) => onChange(writeGroups(next))

	const addCondition = (groupIndex: number) => {
		const first = operands[0]
		if (!first) {
			return
		}
		const row: RowCondition = {
			field: first.name,
			operator: firstOperatorFor(first.conditionType),
			value: undefined,
		}
		emit(
			groups.length === 0
				? [[row]]
				: groups.map((group, index) => (index === groupIndex ? [...group, row] : group))
		)
	}

	const addOrGroup = () => {
		const first = operands[0]
		if (!first) {
			return
		}
		emit([
			...groups,
			[{ field: first.name, operator: firstOperatorFor(first.conditionType), value: undefined }],
		])
	}

	const updateRow = (groupIndex: number, rowIndex: number, row: RowCondition) =>
		emit(
			groups.map((group, index) =>
				index === groupIndex
					? group.map((existing, position) => (position === rowIndex ? row : existing))
					: group
			)
		)

	const removeRow = (groupIndex: number, rowIndex: number) =>
		emit(
			groups
				.map((group, index) =>
					index === groupIndex ? group.filter((_, position) => position !== rowIndex) : group
				)
				.filter((group) => group.length > 0)
		)

	if (operands.length === 0) {
		return <p className="form-builder-condition__hint">{t(keys.conditionNoFields)}</p>
	}

	return (
		<div className="form-builder-condition">
			{groups.length === 0 ? (
				<p className="form-builder-condition__hint">{t(keys.conditionEmpty)}</p>
			) : (
				groups.map((group, groupIndex) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: groups are positional and never reordered
					<div key={groupIndex} className="form-builder-condition__group">
						{groupIndex > 0 ? (
							<div className="form-builder-condition__or">{t(keys.conditionOr)}</div>
						) : null}
						{group.map((row, rowIndex) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reordered
							<div key={rowIndex} className="form-builder-condition__and">
								{rowIndex > 0 ? <span>{t(keys.conditionAnd)}</span> : null}
								<ConditionRow
									condition={row}
									operands={operands}
									onChange={(next) => updateRow(groupIndex, rowIndex, next)}
									onRemove={() => removeRow(groupIndex, rowIndex)}
								/>
							</div>
						))}
						<button type="button" onClick={() => addCondition(groupIndex)}>
							{t(keys.conditionAddCondition)}
						</button>
					</div>
				))
			)}
			<div className="form-builder-condition__actions">
				<button
					type="button"
					onClick={() => (groups.length === 0 ? addCondition(0) : addOrGroup())}
				>
					{groups.length === 0 ? t(keys.conditionAddCondition) : t(keys.conditionAddOr)}
				</button>
			</div>
		</div>
	)
}
