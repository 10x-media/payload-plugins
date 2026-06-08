import type { Field } from 'payload'

/** The stored value shapes a field type can declare. Drives `validate`/`format` typing and value coercion. */
export type FormFieldValueKind = 'text' | 'number' | 'boolean' | 'date' | 'text[]'

export type ValueKindTypeMap = {
	text: string
	number: number
	boolean: boolean
	date: string
	'text[]': string[]
}

export type ValueOfKind<K extends FormFieldValueKind> = ValueKindTypeMap[K]

/** Resolved per-instance config values for a field type (loose at the DB boundary, narrowed by the author's generic). */
export type FormFieldConfigValues = Record<string, unknown>

/** A `t`-like resolver. The engine supplies one from the request i18n; the renderer will supply the client i18n. */
export type Translate = (key: string) => string

export type FormFieldValidateArgs<
	K extends FormFieldValueKind,
	TConfig extends FormFieldConfigValues,
> = {
	value: ValueOfKind<K> | null | undefined
	config: TConfig
	siblingData: Record<string, unknown>
	data: Record<string, unknown>
	locale: string
	t: Translate
}

export type FormFieldValidate<
	K extends FormFieldValueKind,
	TConfig extends FormFieldConfigValues,
> = (args: FormFieldValidateArgs<K, TConfig>) => Promise<string | true> | string | true

export type FormFieldFormatArgs<
	K extends FormFieldValueKind,
	TConfig extends FormFieldConfigValues,
> = {
	value: ValueOfKind<K> | null | undefined
	config: TConfig
	optionLabels?: Record<string, string>
	locale: string
	t: Translate
}

export type FormFieldFormat<K extends FormFieldValueKind, TConfig extends FormFieldConfigValues> = (
	args: FormFieldFormatArgs<K, TConfig>
) => string

/**
 * A field type, authored once. `value` drives typed `validate`/`format`; `config` is a Payload
 * `Field[]` for the add-field drawer; `Field` is the client renderer import-map ref (Phase 4);
 * `label` is an i18n key or a literal.
 */
export type FormFieldDefinition<
	K extends FormFieldValueKind = FormFieldValueKind,
	TConfig extends FormFieldConfigValues = FormFieldConfigValues,
> = {
	type: string
	label: string
	value: K
	config?: Field[]
	validate?: FormFieldValidate<K, TConfig>
	format?: FormFieldFormat<K, TConfig>
	Field?: string
	icon?: string
	group?: string
}

/** The erased shape stored in the heterogeneous registry. Value is `unknown`; config re-narrows per matched type at execution (spec 7.5). */
export type AnyFormFieldValidate = (args: {
	value: unknown
	config: FormFieldConfigValues
	siblingData: Record<string, unknown>
	data: Record<string, unknown>
	locale: string
	t: Translate
}) => Promise<string | true> | string | true

export type AnyFormFieldFormat = (args: {
	value: unknown
	config: FormFieldConfigValues
	optionLabels?: Record<string, string>
	locale: string
	t: Translate
}) => string

export type AnyFormFieldDefinition = {
	type: string
	label: string
	value: FormFieldValueKind
	config?: Field[]
	validate?: AnyFormFieldValidate
	format?: AnyFormFieldFormat
	Field?: string
	icon?: string
	group?: string
}
