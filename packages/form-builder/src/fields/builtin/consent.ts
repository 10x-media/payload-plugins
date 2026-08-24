import type { ConsentDisplay } from '../../consent/effectiveStatement'
import { keys } from '../../translations/keys'
import { labelForKey } from '../../translations/server'
import { defineFormField } from '../defineFormField'

type ConsentConfig = { source?: string; required?: boolean; display?: ConsentDisplay }

const SOURCE_FIELD_REF = '@10x-media/form-builder/client#EndpointOptionsSelect'

/**
 * Consent is a reference, so the field is a reference: the author picks a source and nothing else.
 * The statement, the policy page, and its version all live with the source (see
 * `consentSourcesField`), so there is no wording to copy per form, no URL to paste, and no version
 * to type; correcting a statement corrects every form pointing at it. `label` and `placeholder` are
 * dropped for the same reason: the statement is the visible text and the checkbox's accessible name.
 *
 * Registered only when the plugin's `consent.sources` resolver is set, since a consent field with
 * no source to reference has nothing to say and nothing to prove.
 *
 * The intrinsic validator owns `required`: the engine's shared required guard only fires on an
 * empty value, and `false` (the coerced state of both an unchecked box and an absent answer) is a
 * present one, so without this a required consent would accept an explicit refusal.
 *
 * `display: 'notice'` renders the statement as prose with no control: the submit itself is the
 * consent, so there is no value for `required` to gate and validation always passes; the server
 * records `agreed: true` on the proof regardless of what the client sent.
 */
export const consentField = defineFormField<'boolean', ConsentConfig>({
	type: 'consent',
	label: keys.fieldTypeConsent,
	value: 'boolean',
	omitShared: ['label', 'placeholder', 'description'],
	blockLabel: '@10x-media/form-builder/client#ConsentBlockLabel',
	config: [
		{
			name: 'source',
			type: 'text',
			label: labelForKey(keys.consentConfigSource),
			admin: {
				components: {
					Field: {
						path: SOURCE_FIELD_REF,
						clientProps: {
							endpoint: 'consent-sources',
							descriptionKey: keys.consentConfigSourceDescription,
							isClearable: false,
						},
					},
				},
			},
		},
		{
			name: 'display',
			type: 'select',
			defaultValue: 'checkbox',
			label: labelForKey(keys.consentConfigDisplay),
			admin: { isClearable: false, description: labelForKey(keys.consentConfigDisplayDescription) },
			options: [
				{ label: labelForKey(keys.consentDisplayCheckbox), value: 'checkbox' },
				{ label: labelForKey(keys.consentDisplayNotice), value: 'notice' },
			],
		},
	],
	validate: ({ value, config, t }) =>
		config.display !== 'notice' && config.required === true && value !== true
			? t(keys.validationRequired)
			: true,
	format: ({ value, t }) => t(value === true ? keys.formatYes : keys.formatNo),
})
