import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'
import { localizedIf } from '../localizedIf'

type RepeaterConfig = {
	minRows?: number
	maxRows?: number
	addLabel?: string
}

/** `addLabel` is the visitor-facing add-row button text and follows `localize`; row bounds never do. */
export const buildRepeaterField = (localize: boolean) =>
	defineFormField<'repeater', RepeaterConfig>({
		type: 'repeater',
		label: keys.fieldTypeRepeater,
		value: 'repeater',
		omitShared: ['placeholder'],
		config: [
			{
				name: 'minRows',
				type: 'number',
				min: 0,
				label: labelFor(keys.configMinRows),
			},
			{
				name: 'maxRows',
				type: 'number',
				min: 1,
				label: labelFor(keys.configMaxRows),
			},
			{
				name: 'addLabel',
				type: 'text',
				label: labelFor(keys.configAddLabel),
				...localizedIf(localize),
			},
			// subFields blocks field is injected by buildFieldBlocks after the main loop,
			// so all non-repeater blocks are available and repeater-in-repeater is excluded.
		],
		validate: ({ value, config, t }) => {
			const rows = Array.isArray(value) ? value : []
			const min = typeof config.minRows === 'number' ? config.minRows : 0
			if (rows.length < min) {
				return t(keys.validationRepeaterMin).replace('{min}', String(min))
			}
			const max = typeof config.maxRows === 'number' ? config.maxRows : undefined
			if (max != null && rows.length > max) {
				return t(keys.validationRepeaterMax).replace('{max}', String(max))
			}
			return true
		},
		format: ({ value, t }) => {
			const count = Array.isArray(value) ? value.length : 0
			return t(keys.repeaterRowCount).replace('{count}', String(count))
		},
	})

export const repeaterField = buildRepeaterField(true)
