import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'

type CheckboxConfig = { required?: boolean; display?: 'checkbox' | 'switch' }

/**
 * A checkbox renders as a lone box with no free-text affordance, so `placeholder` is never read.
 * The intrinsic validator owns `required`: the engine's shared required guard only fires on an
 * empty value, and `false` (checked, then unchecked) is a present one, so without this a required
 * checkbox would accept an explicit refusal.
 */
export const checkboxField = defineFormField<'boolean', CheckboxConfig>({
	type: 'checkbox',
	label: keys.fieldTypeCheckbox,
	value: 'boolean',
	omitShared: ['placeholder'],
	config: [
		{
			name: 'display',
			type: 'select',
			defaultValue: 'checkbox',
			label: labelFor(keys.configCheckboxDisplay),
			admin: { isClearable: false },
			options: [
				{ label: labelFor(keys.checkboxDisplayCheckbox), value: 'checkbox' },
				{ label: labelFor(keys.checkboxDisplaySwitch), value: 'switch' },
			],
		},
	],
	validate: ({ value, config, t }) =>
		config.required === true && value !== true ? t(keys.validationRequired) : true,
	format: ({ value, t }) => (value ? t(keys.formatYes) : t(keys.formatNo)),
})
