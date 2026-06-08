import type { Field } from 'payload'
import { keys } from '../translations/keys'
import { labelFor } from '../translations/server'

/**
 * Config every field instance carries regardless of type. `name` is the machine key written into
 * submissions; `width` is stored now for the Phase 4 layout grid. Field types add their own `config`
 * after these. Width option labels stay literal in Phase 1 (Payload option labels are localized when
 * we confirm the option-label type).
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
	{ name: 'visibleWhen', type: 'json', label: labelFor(keys.configVisibleWhen) },
	{ name: 'validateWhen', type: 'json', label: labelFor(keys.configValidateWhen) },
]
