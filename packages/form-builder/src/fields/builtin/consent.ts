import { keys } from '../../translations/keys'
import { labelFor } from '../../translations/server'
import { defineFormField } from '../defineFormField'

type ConsentConfig = {
	statement?: string
	source?: string
	sourceConfig?: {
		label?: string
		url?: string
		version?: string
		relationTo?: string
		docId?: string
		urlField?: string
		captureVersion?: boolean
	}
	optional?: boolean
}

export const consentField = defineFormField<'boolean', ConsentConfig>({
	type: 'consent',
	label: keys.fieldTypeConsent,
	value: 'boolean',
	config: [
		{ name: 'statement', type: 'text', label: labelFor(keys.consentConfigStatement) },
		{
			name: 'source',
			type: 'select',
			defaultValue: 'static',
			label: labelFor(keys.consentConfigSource),
			options: [
				{ label: labelFor(keys.consentSourceStatic), value: 'static' },
				{ label: labelFor(keys.consentSourcePageReference), value: 'pageReference' },
			],
		},
		// The source params are nested so their names (label/url/...) cannot collide with the shared field config (name/label/required/...) that buildFieldBlocks prepends. The source's `resolve` receives this group object as its config.
		{
			name: 'sourceConfig',
			type: 'group',
			label: labelFor(keys.consentConfigSourceConfig),
			fields: [
				{ name: 'label', type: 'text', label: labelFor(keys.consentConfigLabel) },
				{ name: 'url', type: 'text', label: labelFor(keys.consentConfigUrl) },
				{ name: 'version', type: 'text', label: labelFor(keys.consentConfigVersion) },
				{ name: 'relationTo', type: 'text', label: labelFor(keys.consentConfigRelationTo) },
				{ name: 'docId', type: 'text', label: labelFor(keys.consentConfigDocId) },
				{
					name: 'urlField',
					type: 'text',
					defaultValue: 'slug',
					label: labelFor(keys.consentConfigUrlField),
				},
				{
					name: 'captureVersion',
					type: 'checkbox',
					label: labelFor(keys.consentConfigCaptureVersion),
				},
			],
		},
		// Consent is required-to-submit by default (compliance); check `optional` for marketing-style opt-ins.
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
