import type { ReactNode } from 'react'
import type { FormFieldInstance } from '../submissions/types'

/** A localized translator the renderer uses for built-in copy. `(key) => string`; unknown keys return the key. */
export type RendererTranslate = (key: string) => string

/**
 * The props every field renderer receives. The renderer turns one field instance plus its current value
 * into an accessible control. Supplied by `<Form>` or directly in tests. Generic over the
 * value type so custom renderers can narrow it.
 */
export type FieldRendererProps<TValue = unknown> = {
	/** The stored field instance (name, label, blockType, required, placeholder, description, options, ...). */
	field: FormFieldInstance
	/** The control's stable id, for label/aria wiring. */
	id: string
	/** The field machine name (form value key). */
	name: string
	value: TValue | undefined
	onChange: (value: TValue) => void
	onBlur: () => void
	/** Blocking error messages for this field. */
	errors: string[]
	required: boolean
	disabled?: boolean
	locale: string
	t: RendererTranslate
}

/** A field renderer: maps `FieldRendererProps` to React output. */
export type FieldRenderer<TValue = unknown> = (props: FieldRendererProps<TValue>) => ReactNode

/** Identity helper that pins a renderer to the `FieldRenderer` type so authors get prop inference. */
export const defineFieldRenderer = <TValue = unknown>(
	renderer: FieldRenderer<TValue>
): FieldRenderer<TValue> => renderer
