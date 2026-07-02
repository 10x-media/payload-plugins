'use client'

import { Button, useFormFields } from '@payloadcms/ui'
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

const S = {
	root: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } as const,
	hint: { color: 'var(--theme-elevation-400)', fontSize: '0.875rem', margin: 0 } as const,
	group: {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.375rem',
		padding: '0.75rem',
		border: '1px solid var(--theme-elevation-150)',
		borderRadius: 'var(--style-radius-m)',
	} as const,
	orBadge: {
		display: 'flex',
		alignItems: 'center',
		gap: '0.5rem',
		marginBlock: '0.125rem',
	} as const,
	orLine: { flex: 1, height: '1px', background: 'var(--theme-elevation-150)' } as const,
	orText: {
		fontSize: '0.6875rem',
		fontWeight: 700,
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		color: 'var(--theme-elevation-400)',
		whiteSpace: 'nowrap',
	} as const,
	andRow: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } as const,
	andBadge: {
		fontSize: '0.6875rem',
		fontWeight: 700,
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		color: 'var(--theme-elevation-400)',
		paddingInlineStart: '0.125rem',
	} as const,
	addCondition: { alignSelf: 'flex-start', marginBlockStart: '0.25rem' } as const,
	actions: { display: 'flex', gap: '0.5rem' } as const,
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
		return <p style={S.hint}>{t(keys.conditionNoFields)}</p>
	}

	return (
		<div style={S.root}>
			{groups.length === 0 ? (
				<p style={S.hint}>{t(keys.conditionEmpty)}</p>
			) : (
				groups.map((group, groupIndex) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: groups are positional and never reordered
					<div key={groupIndex} style={S.group}>
						{groupIndex > 0 ? (
							<div style={S.orBadge}>
								<span style={S.orLine} />
								<span style={S.orText}>{t(keys.conditionOr)}</span>
								<span style={S.orLine} />
							</div>
						) : null}
						{group.map((row, rowIndex) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and never reordered
							<div key={rowIndex} style={S.andRow}>
								{rowIndex > 0 ? <span style={S.andBadge}>{t(keys.conditionAnd)}</span> : null}
								<ConditionRow
									condition={row}
									operands={operands}
									onChange={(next) => updateRow(groupIndex, rowIndex, next)}
									onRemove={() => removeRow(groupIndex, rowIndex)}
								/>
							</div>
						))}
						<div style={S.addCondition}>
							<Button buttonStyle="secondary" size="small" onClick={() => addCondition(groupIndex)}>
								+ {t(keys.conditionAddCondition)}
							</Button>
						</div>
					</div>
				))
			)}
			<div style={S.actions}>
				<Button
					buttonStyle="secondary"
					size="small"
					onClick={() => (groups.length === 0 ? addCondition(0) : addOrGroup())}
				>
					{groups.length === 0 ? `+ ${t(keys.conditionAddCondition)}` : t(keys.conditionAddOr)}
				</Button>
			</div>
		</div>
	)
}
