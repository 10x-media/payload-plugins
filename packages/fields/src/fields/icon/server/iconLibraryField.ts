import type {
	TextField,
	TextFieldManyValidation,
	TextFieldSingleValidation,
	TextFieldValidation,
} from 'payload'
import { text } from 'payload/shared'
import { getFieldsRegistry } from '../../../plugin/registry'
import { keys } from '../../../translations/keys'
import { asTranslate, labelForKey } from '../../../translations/server'
import type { IconAdapter } from '../../../types'

export type IconLibraryFieldOptions = {
	name?: string
	label?: TextField['label']
	required?: boolean
	hasMany?: boolean
	/** Inline adapters; omit to derive options from the plugin registry at runtime. */
	adapters?: IconAdapter[]
	overrides?: (args: { field: TextField }) => TextField
}

type ValidateOptions = Parameters<TextFieldValidation>[1]
type ValidateResult = ReturnType<TextFieldValidation>

const createLibraryValidate =
	(args: { adapters?: IconAdapter[]; required: boolean }) =>
	(value: unknown, options: ValidateOptions): ValidateResult => {
		const values = value == null ? [] : Array.isArray(value) ? value : [value]
		if (values.length > 0) {
			const registered = new Set(
				(args.adapters ?? getFieldsRegistry(options.req.payload.config)?.icon?.adapters ?? []).map(
					(adapter) => adapter.slug
				)
			)
			for (const candidate of values) {
				if (typeof candidate !== 'string' || !registered.has(candidate)) {
					return asTranslate(options.req.t)(keys.invalidIconLibraryValue, {
						value: String(candidate),
					})
				}
			}
		}
		// Payload's own text validator takes both the single and hasMany shapes at
		// runtime; core sanitization assigns this same string-typed validator to
		// hasMany text fields.
		return text(value as null | string | undefined, {
			...options,
			required: options.required ?? args.required,
		})
	}

/**
 * Text-backed picker for one or more registered icon library slugs. Pairs with
 * `iconField()` when a document chooses its own library, and is validated
 * against the same adapter set.
 */
export const iconLibraryField = (options: IconLibraryFieldOptions = {}): TextField => {
	// One validator handles both shapes; each branch casts it to that branch's
	// signature, because Payload's TextField discriminates validate on hasMany.
	const validate = createLibraryValidate({
		adapters: options.adapters,
		required: options.required === true,
	})
	const base = {
		name: options.name ?? 'iconLibrary',
		type: 'text' as const,
		label: options.label ?? labelForKey(keys.fieldIconLibraryLabel),
		...(options.required === true ? { required: true as const } : {}),
		admin: {
			components: {
				Field: {
					path: '@10x-media/fields/rsc#IconLibrarySelectServer',
					serverProps: { adapters: options.adapters },
				},
			},
		},
	}
	const field: TextField =
		options.hasMany === true
			? { ...base, hasMany: true, validate: validate as TextFieldManyValidation }
			: { ...base, validate: validate as TextFieldSingleValidation }
	return options.overrides ? options.overrides({ field }) : field
}
