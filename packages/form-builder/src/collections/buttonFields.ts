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
 * Composes the forms `buttons` group. Receives the three default fields with the content
 * localization flag already applied; the returned array becomes the group's fields verbatim, so
 * wrapping a default in a `row` with a host field, reordering, or dropping one is explicit.
 */
export type ButtonFieldsOverride = (args: { defaultFields: DefaultButtonFields }) => Field[]

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
