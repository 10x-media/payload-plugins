import type { Field, PayloadRequest } from 'payload'
import { fieldNames, fieldNamesOfType } from '../fields/fieldNamesOfType'
import { keys, type TranslationKey } from '../translations/keys'
import { asTranslate, labelFor } from '../translations/server'

const FIELD_NAME_SELECT_REF = '@10x-media/form-builder/client#FieldNameSelect'

export type FieldTargetParamOptions = {
	/** Field label; defaults to the shared `Field name` key. */
	label?: TranslationKey
	/** Whether a target must be chosen; defaults to `true`. */
	required?: boolean
	/** Restrict the picker (and the save-time check) to these field-type slugs; omit for every field. */
	types?: string[]
	/** Optional description shown under the picker, resolved client-side from this key. */
	description?: TranslationKey
}

/**
 * A rule/action param that targets another field on the same form by name. Stores the field name as a
 * plain text value (no data migration), but authors it with the `FieldNameSelect` picker and enforces
 * a save-time existence check so a name that no longer resolves (typically because the field was
 * removed) is a save error rather than a silently dead reference. The picker options and this check
 * read the same name set from `fieldNamesOfType`/`fieldNames`, so they cannot drift. Reusable by
 * custom rules via the package's public export.
 */
export const fieldTargetParam = (name: string, opts?: FieldTargetParamOptions): Field => {
	const types = opts?.types
	return {
		name,
		type: 'text',
		required: opts?.required ?? true,
		label: labelFor(opts?.label ?? keys.ruleParamField),
		admin: {
			components: {
				Field: {
					path: FIELD_NAME_SELECT_REF,
					clientProps: {
						types,
						...(opts?.description ? { descriptionKey: opts.description } : {}),
					},
				},
			},
		},
		validate: (value: unknown, { data, req }: { data?: unknown; req: PayloadRequest }) => {
			if (typeof value !== 'string' || value.length === 0) {
				return true
			}
			const fields =
				data && typeof data === 'object' ? (data as Record<string, unknown>).fields : undefined
			const names = types ? fieldNamesOfType(fields, types) : fieldNames(fields)
			return names.includes(value) ? true : asTranslate(req.t)(keys.ruleFieldTargetInvalid)
		},
	}
}
