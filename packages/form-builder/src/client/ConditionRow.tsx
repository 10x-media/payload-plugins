'use client'

import {
	Button,
	DateCondition,
	NumberCondition,
	ReactSelect,
	type ReactSelectOption,
	SelectCondition,
	TextCondition,
} from '@payloadcms/ui'
import type { Operator } from 'payload'
import {
	conditionOperators,
	firstOperatorFor,
	operatorLabelKey,
	operatorValueShape,
} from '../conditions/fieldTypes'
import { keys } from '../translations/keys'
import { useTranslation } from '../translations/useTranslation'
import {
	type ConditionOperand,
	dateClientField,
	numberClientField,
	selectClientField,
	textClientField,
} from './synthesizeClientField'

export type RowCondition = { field: string; operator: Operator; value: unknown }

export type ConditionRowProps = {
	condition: RowCondition
	operands: ConditionOperand[]
	onChange: (next: RowCondition) => void
	onRemove: () => void
}

/** ReactSelect's `onChange` hands back `Option | Option[]`; narrow it to the single chosen option. */
const singleOption = (
	selected: ReactSelectOption | ReactSelectOption[]
): ReactSelectOption | undefined => (Array.isArray(selected) ? selected[0] : selected)

const S = {
	row: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'nowrap' } as const,
	field: { flex: '1 1 9rem', minWidth: 0 } as const,
	operator: { flex: '0 1 9rem', minWidth: 0 } as const,
	value: { flex: '1 1 9rem', minWidth: 0 } as const,
	remove: { flexShrink: 0, alignSelf: 'center' } as const,
}

export const ConditionRow = ({ condition, operands, onChange, onRemove }: ConditionRowProps) => {
	const { t, i18n } = useTranslation()
	const operand = operands.find((entry) => entry.name === condition.field)
	const conditionType = operand?.conditionType ?? 'text'
	const operators = conditionOperators[conditionType]

	const fieldOptions: ReactSelectOption[] = operands.map((entry) => ({
		label: entry.label,
		value: entry.name,
	}))
	const operatorOptions: ReactSelectOption[] = operators.map((operator) => ({
		label: i18n.t(operatorLabelKey(operator)),
		value: operator,
	}))

	const handleFieldChange = (selected: ReactSelectOption | ReactSelectOption[]) => {
		const chosen = singleOption(selected)
		const next = operands.find((entry) => entry.name === chosen?.value)
		if (!next) {
			return
		}
		onChange({
			field: next.name,
			operator: firstOperatorFor(next.conditionType),
			value: undefined,
		})
	}

	const handleOperatorChange = (selected: ReactSelectOption | ReactSelectOption[]) => {
		const chosen = singleOption(selected)
		if (!chosen) {
			return
		}
		const operator = chosen.value as Operator
		const keepValue = operatorValueShape(condition.operator) === operatorValueShape(operator)
		onChange({ ...condition, operator, value: keepValue ? condition.value : undefined })
	}

	return (
		<div style={S.row}>
			<div style={S.field}>
				<ReactSelect
					options={fieldOptions}
					value={fieldOptions.find((option) => option.value === condition.field)}
					placeholder={t(keys.conditionSelectField)}
					isClearable={false}
					onChange={handleFieldChange}
				/>
			</div>
			<div style={S.operator}>
				<ReactSelect
					options={operatorOptions}
					value={operatorOptions.find((option) => option.value === condition.operator)}
					disabled={!operand}
					isClearable={false}
					onChange={handleOperatorChange}
				/>
			</div>
			<div style={S.value}>
				<ConditionValue
					conditionType={conditionType}
					operand={operand}
					operator={condition.operator}
					value={condition.value}
					onChange={(value) => onChange({ ...condition, value })}
				/>
			</div>
			<div style={S.remove}>
				<Button
					buttonStyle="error"
					size="small"
					onClick={onRemove}
					aria-label={t(keys.conditionRemove)}
				>
					&#x2715;
				</Button>
			</div>
		</div>
	)
}

type ConditionValueProps = {
	conditionType: ConditionOperand['conditionType']
	operand?: ConditionOperand
	operator: Operator
	value: unknown
	onChange: (value: unknown) => void
}

const ConditionValue = ({
	conditionType,
	operand,
	operator,
	value,
	onChange,
}: ConditionValueProps) => {
	const { t } = useTranslation()
	if (conditionType === 'checkbox' || operatorValueShape(operator) === 'boolean') {
		const options: ReactSelectOption[] = [
			{ label: t(keys.conditionTrue), value: 'true' },
			{ label: t(keys.conditionFalse), value: 'false' },
		]
		const handleBooleanChange = (selected: ReactSelectOption | ReactSelectOption[]) => {
			const chosen = singleOption(selected)
			onChange(chosen?.value === 'true')
		}
		return (
			<ReactSelect
				options={options}
				value={options.find((option) => String(option.value) === String(value)) ?? options[0]}
				isClearable={false}
				onChange={handleBooleanChange}
			/>
		)
	}
	if (!operand) {
		return null
	}
	switch (conditionType) {
		case 'number':
			return (
				<NumberCondition
					disabled={false}
					field={numberClientField(operand)}
					operator={operator}
					value={value as number | number[]}
					onChange={(next: string) => onChange(next)}
				/>
			)
		case 'date':
			return (
				<DateCondition
					disabled={false}
					field={dateClientField(operand)}
					operator={operator}
					value={value as Date | string}
					onChange={(next: Date | string) => onChange(next)}
				/>
			)
		case 'select':
			return (
				<SelectCondition
					disabled={false}
					field={selectClientField(operand)}
					operator={operator}
					options={operand.options ?? []}
					value={value as string}
					onChange={(next: string) => onChange(next)}
				/>
			)
		default:
			return (
				<TextCondition
					disabled={false}
					field={textClientField(operand)}
					operator={operator}
					value={value as string | string[]}
					onChange={(next: string) => onChange(next)}
				/>
			)
	}
}
