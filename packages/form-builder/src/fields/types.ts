import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Field, Payload, PayloadRequest } from 'payload'
import type { ConditionFieldType } from '../conditions/fieldTypes'
import type { PollOption } from '../poll/definePollOptionSource'
import type { FormFieldInstance } from '../submissions/types'
import type { FileRef } from '../uploads/types'

/**
 * The stored value shapes a field type can declare. Drives `validate`/`format` typing and value
 * coercion. `'none'` marks a display-only type (e.g. `message`): the engine never seeds, validates,
 * or stores a value for it, and a client-sent value under its name is dropped.
 */
export type FormFieldValueKind =
	| 'text'
	| 'number'
	| 'boolean'
	| 'date'
	| 'text[]'
	| 'file'
	| 'repeater'
	| 'none'

export type ValueKindTypeMap = {
	text: string
	number: number
	boolean: boolean
	date: string
	'text[]': string[]
	file: FileRef
	repeater: Array<Record<string, unknown>>
	none: never
}

export type ValueOfKind<K extends FormFieldValueKind> = ValueKindTypeMap[K]

/** Resolved per-instance config values for a field type (loose at the DB boundary, narrowed by the author's generic). */
export type FormFieldConfigValues = Record<string, unknown>

/**
 * The shared config fields a type may drop via {@link FormFieldDefinition.omitShared}. `name` is
 * deliberately absent and can never be dropped: it is the storage key every read and write path
 * gates on (see `isNamedField`), so a named field without it would silently store nothing.
 */
export type OmittableSharedField = 'label' | 'placeholder' | 'description' | 'width' | 'required'

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

/** Arguments a {@link FormFieldDefinition.resolveOptions} implementation receives. */
export type ResolveFieldOptionsArgs = {
	/** The configured field instance, so the resolver can read the values the author selected. */
	instance: FormFieldInstance
	form: { id: number | string; title?: string }
	payload: Payload
	req?: PayloadRequest
}

/**
 * A field type, authored once. `value` drives typed `validate`/`format`; `config` is a Payload
 * `Field[]` for the add-field drawer; `Field` is the client renderer import-map ref;
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
	/** Optional Standard Schema validator (Zod/Valibot/etc.), run by the engine after the intrinsic validator. */
	schema?: StandardSchemaV1
	icon?: string
	group?: string
	/** How this field appears in the condition builder. Defaults from `value` (see `defaultConditionType`). */
	conditionType?: ConditionFieldType
	/**
	 * Bare definitions render without the shared chrome: no name/label/width/required/placeholder/
	 * description and no validation tabs; the definition's `config` IS the entire block. Instances
	 * are nameless (identified by Payload's hidden block row `id`, see `fieldKey`), so bare types
	 * must be display-only (`value: 'none'`): with no name there is nothing to validate or store.
	 */
	bare?: boolean
	/**
	 * Shared config fields this type never uses, so authors are not offered a setting the renderer
	 * ignores (e.g. a placeholder on a checkbox). Unlike `bare`, which drops the shared chrome
	 * wholesale, this keeps the rest of it. An emptied layout row collapses and a lone survivor
	 * spans the row (see `sharedFieldConfig`).
	 */
	omitShared?: OmittableSharedField[]
	/**
	 * The type can be chosen as a poll's results field. Its instances must produce enumerable
	 * answers: either authored `options` or options resolved from a poll option source.
	 */
	pollEligible?: boolean
	/**
	 * Source this `pollEligible` type's poll choices from the field instance itself, instead of
	 * authored `options` or a poll `optionSource`. A type that holds enumerable data (for example a
	 * `hasMany` relationship to the voteable records) returns one {@link PollOption} per selectable
	 * value, read from the live instance the author configured (so it can `payload.find` over the
	 * ids it holds). The result backs submission validation, the admin winner select, and results
	 * labeling exactly like a source would; it is consulted after an `optionSource` and before the
	 * instance's authored `options`.
	 */
	resolveOptions?: (args: ResolveFieldOptionsArgs) => PollOption[] | Promise<PollOption[]>
}

/** The erased shape stored in the heterogeneous registry. Value is `unknown`; config re-narrows per matched type at execution. */
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
	schema?: StandardSchemaV1
	icon?: string
	group?: string
	/** How this field appears in the condition builder. Defaults from `value` (see `defaultConditionType`). */
	conditionType?: ConditionFieldType
	/** See `FormFieldDefinition.bare`: the block is the definition's `config` alone, instances are nameless. */
	bare?: boolean
	/** See `FormFieldDefinition.omitShared`: shared config fields this type never uses, never authored. */
	omitShared?: OmittableSharedField[]
	/** See `FormFieldDefinition.pollEligible`: choosable as a poll's results field. */
	pollEligible?: boolean
	/** See `FormFieldDefinition.resolveOptions`: source poll choices from the instance itself. */
	resolveOptions?: (args: ResolveFieldOptionsArgs) => PollOption[] | Promise<PollOption[]>
}
