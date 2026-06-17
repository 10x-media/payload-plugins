import type { AnyFormFieldDefinition } from '../types'
import { calculationField } from './calculation'
import { checkboxField } from './checkbox'
import { consentField } from './consent'
import { emailField } from './email'
import { numberField } from './number'
import { selectField } from './select'
import { textField } from './text'
import { textareaField } from './textarea'

// Field types are authored with precise value/config generics; the registry stores them erased
// (config is re-narrowed per matched type at execution, spec 7.5). One cast per built-in, no `any`.
export const defaultFieldDefinitions: AnyFormFieldDefinition[] = [
	textField as AnyFormFieldDefinition,
	textareaField as AnyFormFieldDefinition,
	emailField as AnyFormFieldDefinition,
	numberField as AnyFormFieldDefinition,
	selectField as AnyFormFieldDefinition,
	checkboxField as AnyFormFieldDefinition,
	calculationField as AnyFormFieldDefinition,
	consentField as AnyFormFieldDefinition,
]
