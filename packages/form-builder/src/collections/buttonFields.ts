import type { Field } from 'payload'
import { localizedIf } from '../fields/localizedIf'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

/** The default button-label fields, keyed by button. What the `buttons.fields` seam receives. */
export type DefaultButtonFields = {
	submit: Field
	prev: Field
	next: Field
}

/**
 * Composes the three form-level button fields. Receives the defaults with the content localization
 * flag already applied and returns the field for each slot; the collection places `submit` at the
 * bottom of the Fields tab and `prev`/`next` in a row on the Flow tab. Any slot may return the
 * default, a replacement, or the default wrapped in a `row` alongside a host field (e.g. an icon
 * select), so adjacent fields ride along in the same slot.
 */
export type ButtonFieldsOverride = (args: {
	defaultFields: DefaultButtonFields
}) => DefaultButtonFields

/** The plugin `buttons` option: form-level button labels and the group's composition seam. */
export type ButtonsOption = {
	fields?: ButtonFieldsOverride
}

/** The default submit button label field (`buttons.submitLabel`), localized when `localize` is true. */
export const buildSubmitLabelField = (localize: boolean): Field => ({
	name: 'submitLabel',
	type: 'text',
	label: labelForKey(keys.buttonsSubmitLabel),
	...localizedIf(localize),
})

/** The default "Next" button label field (`buttons.nextLabel`); applies to multi-step forms. */
export const buildNextLabelField = (localize: boolean): Field => ({
	name: 'nextLabel',
	type: 'text',
	label: labelForKey(keys.buttonsNextLabel),
	admin: { description: labelForKey(keys.buttonsMultiStepDescription) },
	...localizedIf(localize),
})

/** The default "Previous" button label field (`buttons.prevLabel`); applies to multi-step forms. */
export const buildPrevLabelField = (localize: boolean): Field => ({
	name: 'prevLabel',
	type: 'text',
	label: labelForKey(keys.buttonsPrevLabel),
	admin: { description: labelForKey(keys.buttonsMultiStepDescription) },
	...localizedIf(localize),
})

/** All three defaults with the localization flag applied: exactly what the seam is handed. */
export const buildDefaultButtonFields = (localize: boolean): DefaultButtonFields => ({
	submit: buildSubmitLabelField(localize),
	prev: buildPrevLabelField(localize),
	next: buildNextLabelField(localize),
})
