import type { AnyFormFieldDefinition } from '../types'
import { calculationField } from './calculation'
import { checkboxField } from './checkbox'
import { consentField } from './consent'
import { dateField } from './date'
import { emailField } from './email'
import { fileField } from './file'
import { numberField } from './number'
import { repeaterField } from './repeater'
import { selectField } from './select'
import { textField } from './text'
import { textareaField } from './textarea'

// Field types are authored with precise value/config generics; the registry stores them erased
// (config is re-narrowed per matched type at execution). One cast per built-in, no `any`.
export const defaultFieldDefinitions: AnyFormFieldDefinition[] = [
	textField as AnyFormFieldDefinition,
	textareaField as AnyFormFieldDefinition,
	emailField as AnyFormFieldDefinition,
	numberField as AnyFormFieldDefinition,
	selectField as AnyFormFieldDefinition,
	checkboxField as AnyFormFieldDefinition,
	calculationField as AnyFormFieldDefinition,
	consentField as AnyFormFieldDefinition,
	fileField as AnyFormFieldDefinition,
	repeaterField as AnyFormFieldDefinition,
	dateField as AnyFormFieldDefinition,
]

/**
 * `defaultFieldDefinitions` indexed by `type`, so a single built-in can be spread and tweaked
 * without hand-rolling a `.find()`, e.g.
 * `fields: { text: { ...defaultFieldDefinitionsByType.text, validate: myValidate } }`. The
 * `fields` plugin option replaces a built-in of the same `type`; `false` removes it, `true` keeps it.
 */
export const defaultFieldDefinitionsByType: Record<string, AnyFormFieldDefinition> =
	Object.fromEntries(defaultFieldDefinitions.map((definition) => [definition.type, definition]))
