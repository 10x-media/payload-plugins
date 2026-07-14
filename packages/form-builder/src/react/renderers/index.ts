import type { FieldRenderer } from '../contract'
import { calculationRenderer } from './calculation'
import { checkboxRenderer } from './checkbox'
import { consentRenderer } from './consent'
import { dateRenderer } from './date'
import { emailRenderer } from './email'
import { fileRenderer } from './file'
import { numberRenderer } from './number'
import { repeaterRenderer } from './repeater'
import { selectRenderer } from './select'
import { textRenderer } from './text'
import { textareaRenderer } from './textarea'

/** The built-in field renderers, keyed by field-type slug. Override via the renderer registry. */
export const defaultRenderers: Record<string, FieldRenderer> = {
	calculation: calculationRenderer as FieldRenderer,
	checkbox: checkboxRenderer as FieldRenderer,
	consent: consentRenderer as FieldRenderer,
	date: dateRenderer as FieldRenderer,
	email: emailRenderer as FieldRenderer,
	file: fileRenderer as FieldRenderer,
	number: numberRenderer as FieldRenderer,
	repeater: repeaterRenderer as FieldRenderer,
	select: selectRenderer as FieldRenderer,
	text: textRenderer as FieldRenderer,
	textarea: textareaRenderer as FieldRenderer,
}
