import type {
	DateFieldClient,
	NumberFieldClient,
	Option,
	SelectFieldClient,
	TextFieldClient,
} from 'payload'
import type { ConditionFieldType } from '../conditions/fieldTypes'

/** A field row as stored in the form's `fields` blocks array (only the keys the builder reads). */
export type FieldRow = {
	blockType: string
	name?: string
	label?: string
	options?: Option[]
	/** A bare message block's richText body; see `messageSnippet`. */
	content?: unknown
	[key: string]: unknown
}

/** A condition operand: a selectable form field the builder can compare against. */
export type ConditionOperand = {
	name: string
	label: string
	conditionType: ConditionFieldType
	options?: Option[]
}

/**
 * Project a stored field row into a condition operand, or `null` when the row has no usable name or
 * its type is absent from the condition-type map (not conditionable, e.g. a display-only message).
 */
export const operandFromRow = (
	row: FieldRow,
	conditionTypes: Record<string, ConditionFieldType>
): ConditionOperand | null => {
	const name = typeof row.name === 'string' ? row.name.trim() : ''
	if (name.length === 0) {
		return null
	}
	const conditionType = conditionTypes[row.blockType]
	if (!conditionType) {
		return null
	}
	return {
		name,
		label: typeof row.label === 'string' && row.label.length > 0 ? row.label : name,
		conditionType,
		options: Array.isArray(row.options) ? row.options : undefined,
	}
}

/**
 * Build the minimal `*FieldClient` a Payload leaf condition input requires for a given operand. Casts
 * are localized to these four synths and nowhere else: `FieldBaseClient` requires only `name`, and each
 * leaf is `FieldBaseClient & Pick<…, 'type' | …>` where every picked member but `type` (and `select`'s
 * required `options`) is optional, so the literals are structurally complete. Every synth carries an
 * `admin: {}` because Payload's `Select` and `Date` leaf inputs read `field.admin.placeholder`
 * unguarded and throw on a missing `admin`; the empty object also leaves `admin.date` unset, so
 * `DateCondition` still falls back to its default date format. Each synth returns a single concrete
 * client type so leaf `field` props need no narrowing.
 */
export const textClientField = (operand: ConditionOperand): TextFieldClient =>
	({ name: operand.name, label: operand.label, type: 'text', admin: {} }) as TextFieldClient

export const numberClientField = (operand: ConditionOperand): NumberFieldClient =>
	({ name: operand.name, label: operand.label, type: 'number', admin: {} }) as NumberFieldClient

export const dateClientField = (operand: ConditionOperand): DateFieldClient =>
	({ name: operand.name, label: operand.label, type: 'date', admin: {} }) as DateFieldClient

export const selectClientField = (operand: ConditionOperand): SelectFieldClient =>
	({
		name: operand.name,
		label: operand.label,
		type: 'select',
		options: operand.options ?? [],
		admin: {},
	}) as SelectFieldClient
