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
 * submissions; `width` is stored for the layout grid. Field types add their own `config` after
 * these inside the Field tab (see `fieldBlockTabs`).
 */
export const sharedFieldConfig = (): Field[] => [
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
]

/**
 * The single field of every field block: unnamed tabs (presentational only, data paths stay flat).
 * Field tab holds the shared basics plus the type's own config; Validation holds the rule blocks and
 * `validateWhen`; Advanced holds `visibleWhen` and `hidden`. `visibleWhen`/`validateWhen` store a
 * canonical Payload `Where`, edited by the native condition builder.
 */
export const fieldBlockTabs = (
	conditionTypes: Record<string, ConditionFieldType>,
	typeConfig: Field[],
	validations: Field
): Field => ({
	type: 'tabs',
	tabs: [
		{
			label: labelFor(keys.tabField),
			fields: [...sharedFieldConfig(), ...typeConfig],
		},
		{
			label: labelFor(keys.tabValidation),
			fields: [
				validations,
				conditionField('validateWhen', keys.configValidateWhen, conditionTypes),
			],
		},
		{
			label: labelFor(keys.tabAdvanced),
			fields: [
				conditionField('visibleWhen', keys.configVisibleWhen, conditionTypes),
				{ name: 'hidden', type: 'checkbox', label: labelFor(keys.configHidden) },
			],
		},
	],
})
