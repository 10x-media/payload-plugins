import type { Field } from 'payload'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

/** The default form-level flag fields, keyed by flag. What the `settings.fields` seam receives. */
export type SettingsFieldsDefaults = {
	multistep: Field
	pollEnabled: Field
	persistSubmissions: Field
}

/**
 * The plugin `settings` option: composes the three form-level flag fields (sidebar checkboxes by
 * default) from the localized defaults, mirroring `buttons.fields`. The returned array is placed
 * verbatim at the forms collection root, so a host can relocate a flag (strip `admin.position`),
 * wrap them in a row, append its own, or drop one.
 */
export type SettingsOption = {
	fields?: (args: { defaultFields: SettingsFieldsDefaults }) => Field[]
}

/**
 * The three flags: behavior, never localized, sidebar checkboxes by default. `multistep` gates the
 * Flow tab and the client's step navigation; `pollEnabled` gates the Poll tab and marks the form a
 * poll; `persistSubmissions` (default checked) tells the plugin whether to keep a submission's row
 * after its actions run, or prune it (a pure signup form's opt-out).
 */
export const buildDefaultSettingsFields = (): SettingsFieldsDefaults => ({
	multistep: {
		name: 'multistep',
		type: 'checkbox',
		defaultValue: false,
		label: labelForKey(keys.formMultistep),
		admin: { position: 'sidebar' },
	},
	pollEnabled: {
		name: 'pollEnabled',
		type: 'checkbox',
		defaultValue: false,
		label: labelForKey(keys.formPollEnabled),
		admin: { position: 'sidebar' },
	},
	persistSubmissions: {
		name: 'persistSubmissions',
		type: 'checkbox',
		defaultValue: true,
		label: labelForKey(keys.formPersistSubmissions),
		admin: { position: 'sidebar' },
	},
})

export const composeSettingsFields = (settings: SettingsOption | undefined): Field[] => {
	const defaultFields = buildDefaultSettingsFields()
	if (settings?.fields) {
		return settings.fields({ defaultFields })
	}
	return [defaultFields.multistep, defaultFields.pollEnabled, defaultFields.persistSubmissions]
}
