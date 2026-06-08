import type { Field } from 'payload'
import type { ConditionFieldType } from '../conditions/fieldTypes'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'

const CONDITION_FIELD_REF = '@10x-media/form-builder/client#FormConditionField'

const conditionField = (
	name: 'visibleWhen' | 'validateWhen',
	labelKey: string,
	conditionTypes: Record<string, ConditionFieldType>
): Field => ({
	name,
	type: 'json',
	label: labelFor(labelKey),
	admin: {
		components: {
			Field: { path: CONDITION_FIELD_REF, clientProps: { conditionTypes } },
		},
	},
})

/**
 * Config every field instance carries regardless of type. `name` is the machine key written into
 * submissions; `width` is stored now for the Phase 4 layout grid. `visibleWhen`/`validateWhen` store a
 * canonical Payload `Where`, edited by the native condition builder. Field types add their own `config`
 * after these.
 */
export const sharedFieldConfig = (conditionTypes: Record<string, ConditionFieldType>): Field[] => [
	{ name: 'name', type: 'text', required: true, label: labelFor(keys.configName) },
	{ name: 'label', type: 'text', label: labelFor(keys.configLabel) },
	{ name: 'required', type: 'checkbox', label: labelFor(keys.configRequired) },
	{
		name: 'width',
		type: 'select',
		defaultValue: 'full',
		label: labelFor(keys.configWidth),
		options: [
			{ label: 'Full', value: 'full' },
			{ label: 'Half', value: 'half' },
			{ label: 'Third', value: 'third' },
			{ label: 'Two thirds', value: 'twoThirds' },
		],
	},
	{ name: 'placeholder', type: 'text', label: labelFor(keys.configPlaceholder) },
	{ name: 'description', type: 'textarea', label: labelFor(keys.configDescription) },
	conditionField('visibleWhen', keys.configVisibleWhen, conditionTypes),
	conditionField('validateWhen', keys.configValidateWhen, conditionTypes),
]
