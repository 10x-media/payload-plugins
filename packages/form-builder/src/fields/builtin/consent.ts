import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'
import { localizedIf } from '../localizedIf'

type ConsentConfig = {
	statement?: unknown
	source?: string
	sourceConfig?: Record<string, unknown>
	optional?: boolean
}

/**
 * Base consent field definition. `source` select and `sourceConfig` group are injected
 * by `buildFieldBlocks` from the live `consentRegistry`, so only the selected source's
 * fields are visible in the admin UI via `admin.condition`. The `statement` is
 * author-facing rich text (no `editor` key: uses the host config's default) so authors can
 * inline links (e.g. to the privacy policy) rather than relying solely on the separate
 * `consentLinks` row, and follows `localize`. A legacy plain-string `statement` (data authored
 * before this field became richText) still renders; see `consentRenderer`.
 */
export const buildConsentField = (localize: boolean) =>
	defineFormField<'boolean', ConsentConfig>({
		type: 'consent',
		label: keys.fieldTypeConsent,
		value: 'boolean',
		config: [
			{
				name: 'statement',
				type: 'richText',
				label: labelFor(keys.consentConfigStatement),
				admin: { description: labelFor(keys.consentConfigStatementDescription) },
				...localizedIf(localize),
			},
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

export const consentField = buildConsentField(true)
