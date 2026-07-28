import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'
import { localizedIf } from '../localizedIf'

type SelectOption = { label?: string; value: string }
type SelectConfig = { options?: SelectOption[] }

/** Option `label` is author-facing content and follows `localize`; `value` is an identifier and never does. */
export const buildSelectField = (localize: boolean) =>
	defineFormField<'text', SelectConfig>({
		type: 'select',
		label: keys.fieldTypeSelect,
		value: 'text',
		conditionType: 'select',
		pollEligible: true,
		config: [
			{
				name: 'options',
				type: 'array',
				label: labelFor(keys.configOptions),
				labels: { singular: labelFor(keys.configOption), plural: labelFor(keys.configOptions) },
				fields: [
					{
						name: 'label',
						type: 'text',
						label: labelFor(keys.configOptionLabel),
						...localizedIf(localize),
					},
					{ name: 'value', type: 'text', required: true, label: labelFor(keys.configOptionValue) },
				],
			},
		],
		validate: ({ value, config, t }) => {
			if (value == null || value === '') {
				return true
			}
			const options = config.options ?? []
			if (options.length === 0) {
				return true
			}
			return options.some((option) => option.value === value) ? true : t(keys.validationSelect)
		},
		format: ({ value, optionLabels }) => {
			if (value == null || value === '') {
				return ''
			}
			return optionLabels?.[value] ?? String(value)
		},
	})

export const selectField = buildSelectField(true)
