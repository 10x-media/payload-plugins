import type { FieldRenderer } from '../contract'
import { calculationRenderer } from './calculation'
import { checkboxRenderer } from './checkbox'
import { emailRenderer } from './email'
import { numberRenderer } from './number'
import { selectRenderer } from './select'
import { textRenderer } from './text'
import { textareaRenderer } from './textarea'

/** The built-in field renderers, keyed by field-type slug. Override via the renderer registry. */
export const defaultRenderers: Record<string, FieldRenderer> = {
	text: textRenderer as FieldRenderer,
	textarea: textareaRenderer as FieldRenderer,
	email: emailRenderer as FieldRenderer,
	number: numberRenderer as FieldRenderer,
	select: selectRenderer as FieldRenderer,
	checkbox: checkboxRenderer as FieldRenderer,
	calculation: calculationRenderer as FieldRenderer,
}
