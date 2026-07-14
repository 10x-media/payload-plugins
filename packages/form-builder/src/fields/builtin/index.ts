import type { AnyFormFieldDefinition } from '../types'
import { calculationField } from './calculation'
import { checkboxField } from './checkbox'
import { buildConsentField } from './consent'
import { dateField } from './date'
import { emailField } from './email'
import { fileField } from './file'
import { numberField } from './number'
import { buildRepeaterField } from './repeater'
import { buildSelectField } from './select'
import { textField } from './text'
import { textareaField } from './textarea'

/**
 * Built-in field definitions with content-bearing config fields (select option labels, consent
 * statement, repeater add label) carrying `localized: true` when `localize` is true. Field types
 * without content config are shared static definitions. Definitions are authored with precise
 * value/config generics; the registry stores them erased (config is re-narrowed per matched type
 * at execution), hence one cast per built-in, no `any`.
 */
export const buildDefaultFieldDefinitions = (localize: boolean): AnyFormFieldDefinition[] => [
	textField as AnyFormFieldDefinition,
	textareaField as AnyFormFieldDefinition,
	emailField as AnyFormFieldDefinition,
	numberField as AnyFormFieldDefinition,
	buildSelectField(localize) as AnyFormFieldDefinition,
	checkboxField as AnyFormFieldDefinition,
	calculationField as AnyFormFieldDefinition,
	buildConsentField(localize) as AnyFormFieldDefinition,
	fileField as AnyFormFieldDefinition,
	buildRepeaterField(localize) as AnyFormFieldDefinition,
	dateField as AnyFormFieldDefinition,
]

export const defaultFieldDefinitions: AnyFormFieldDefinition[] = buildDefaultFieldDefinitions(true)

/**
 * `defaultFieldDefinitions` indexed by `type`, so a single built-in can be spread and tweaked
 * without hand-rolling a `.find()`, e.g.
 * `fields: { text: { ...defaultFieldDefinitionsByType.text, validate: myValidate } }`. The
 * `fields` plugin option replaces a built-in of the same `type`; `false` removes it, `true` keeps it.
 * Prebuilt with content localization on; with `localizeContent: false`, derive overrides from
 * `buildDefaultFieldDefinitions(false)` instead so the spread does not reintroduce `localized`.
 */
export const defaultFieldDefinitionsByType: Record<string, AnyFormFieldDefinition> =
	Object.fromEntries(defaultFieldDefinitions.map((definition) => [definition.type, definition]))
