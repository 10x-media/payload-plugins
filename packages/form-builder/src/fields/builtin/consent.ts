import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'

type ConsentConfig = {
	statement?: string
	source?: string
	sourceConfig?: Record<string, unknown>
	optional?: boolean
}

/**
 * Base consent field definition. `source` select and `sourceConfig` group are injected
 * by `buildFieldBlocks` from the live `consentRegistry`, so only the selected source's
 * fields are visible in the admin UI via `admin.condition`.
 */
export const consentField = defineFormField<'boolean', ConsentConfig>({
	type: 'consent',
	label: keys.fieldTypeConsent,
	value: 'boolean',
	config: [
		{ name: 'statement', type: 'text', label: labelFor(keys.consentConfigStatement) },
		// source select and sourceConfig group are injected by buildFieldBlocks at plugin boot
		// so the options reflect the live consentRegistry rather than this static list.
		{ name: 'optional', type: 'checkbox', label: labelFor(keys.consentConfigOptional) },
	],
	validate: ({ value, config, t }) => {
		const optional = (config as ConsentConfig).optional === true
		if (!optional && value !== true) {
			return t(keys.validationRequired)
		}
		return true
	},
	format: ({ value, t }) => t(value === true ? keys.formatYes : keys.formatNo),
})
