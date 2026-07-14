'use client'

import type { FieldRenderer, RenderersConfig } from '@10x-media/form-builder/react'
import { calculationField } from './fields/calculation-field'
import { checkboxField } from './fields/checkbox-field'
import { consentField } from './fields/consent-field'
import { dateField } from './fields/date-field'
import { emailField } from './fields/email-field'
import { fileField } from './fields/file-field'
import { messageField } from './fields/message-field'
import { numberField } from './fields/number-field'
import { repeaterField } from './fields/repeater-field'
import { selectField } from './fields/select-field'
import { textField } from './fields/text-field'
import { textareaField } from './fields/textarea-field'

/** shadcn-styled renderers keyed by field-type slug. Pass to `<Form renderers>` or use `<FormBuilderForm>`. */
export const shadcnRenderers: RenderersConfig = {
	text: textField as FieldRenderer,
	textarea: textareaField as FieldRenderer,
	email: emailField as FieldRenderer,
	number: numberField as FieldRenderer,
	select: selectField as FieldRenderer,
	checkbox: checkboxField as FieldRenderer,
	file: fileField as FieldRenderer,
	message: messageField as FieldRenderer,
	date: dateField as FieldRenderer,
	consent: consentField as FieldRenderer,
	calculation: calculationField as FieldRenderer,
	repeater: repeaterField as FieldRenderer,
}
