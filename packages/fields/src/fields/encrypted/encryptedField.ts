import type { Field, TextField } from 'payload'
import { validateKeysConfig } from './crypto/keys'
import { makeAfterReadHook, makeBeforeChangeHook } from './hooks'
import {
	type EncryptedFieldMarker,
	type EncryptedFieldOptions,
	type EncryptedFieldPatch,
	type EncryptedSourceField,
	type EncryptedSourceType,
	FIELDS_CUSTOM_KEY,
} from './types'
import { typescriptSchemaFor } from './typescriptSchema'
import { makeComposedValidate, makeEffectiveValidator } from './validators'

/** Admin keys forwarded to the client patch so native components render correctly. */
const PATCH_ADMIN_KEYS = [
	'autoComplete',
	'date',
	'editorOptions',
	'language',
	'placeholder',
	'rows',
	'step',
] as const

/**
 * Field types whose plaintext is a single scalar the blind index can key on.
 * Blind indexes HMAC a normalized string/number; non-scalar values (objects,
 * tuples, arrays, booleans) have no meaningful equality index, so queryable is
 * rejected for them at the factory (complements the crypto-layer bidx guard).
 */
const QUERYABLE_SOURCE_TYPES: ReadonlySet<EncryptedSourceType> = new Set([
	'email',
	'number',
	'text',
])

const buildFieldPatch = (source: EncryptedSourceField): EncryptedFieldPatch => {
	const patch: EncryptedFieldPatch = { admin: {}, type: source.type }
	if ('hasMany' in source && source.hasMany === true) {
		patch.hasMany = true
	}
	if ('options' in source) {
		patch.options = source.options.map((option) => {
			if (typeof option === 'string') {
				return { label: option, value: option }
			}
			if (typeof option.label !== 'string') {
				throw new Error(
					`@10x-media/fields: encryptedField '${source.name}': option labels must be plain strings (labels travel to the admin client via clientProps)`
				)
			}
			return { label: option.label, value: option.value }
		})
	}
	const admin = (source.admin ?? {}) as Record<string, unknown>
	for (const key of PATCH_ADMIN_KEYS) {
		if (admin[key] !== undefined) {
			;(patch.admin as Record<string, unknown>)[key] = admin[key]
		}
	}
	return patch
}

/**
 * Wraps a Payload field config (text, textarea, email, number, checkbox,
 * date, select, radio, code, json, point, richText) in transparent AES-256-GCM
 * encryption at rest. Returns `[storedField]`, or `[storedField, bidxField]`
 * when `queryable` adds a blind-index sibling; spread into `fields: [...]`.
 */
export const encryptedField = (
	source: EncryptedSourceField,
	options: EncryptedFieldOptions = {}
): Field[] => {
	const { keys, onDecryptFailure, overrides, protection = 'masked', queryable = false } = options
	if (keys) {
		validateKeysConfig(keys)
	}
	const hasMany = 'hasMany' in source && source.hasMany === true
	const unique = 'unique' in source && source.unique === true
	if (queryable && hasMany) {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': queryable is not supported with hasMany`
		)
	}
	if (queryable && !QUERYABLE_SOURCE_TYPES.has(source.type)) {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': queryable is only supported for text, email, and number fields (the blind index requires a scalar value; '${source.type}' is not scalar)`
		)
	}
	if (unique && !queryable) {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': unique requires queryable: true (uniqueness is enforced on the blind index; every ciphertext is unique by construction)`
		)
	}
	if (source.type === 'richText' && protection === 'none') {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': richText is masked-only in the admin (the editor cannot run on an encrypted backing field); edit via the API`
		)
	}

	const marker: EncryptedFieldMarker = {
		bidxName: queryable ? `${source.name}_bidx` : undefined,
		fieldName: source.name,
		hasMany,
		keys,
		localized: 'localized' in source && source.localized === true,
		normalize: source.type === 'email' ? 'email' : 'standard',
		onDecryptFailure,
		queryable,
		sourceType: source.type,
	}
	const effective = makeEffectiveValidator(source)
	const fieldPatch = buildFieldPatch(source)
	// `source` is a union of 12 field types, so `source.admin` (and its
	// `components`) carries the union of every field's admin shape. Narrow to the
	// stored text field's admin type once here so the passthrough spreads below
	// typecheck against the correct target instead of the incompatible union.
	const sourceAdmin = source.admin as TextField['admin']

	// Spread keeps admin passthrough (description, width, condition, readOnly,
	// position, custom labels) and access control on the stored field. Stripped:
	// hooks/validate/typescriptSchema/index/unique/editor (rebuilt or moved to the
	// bidx sibling); defaultValue (a static default emits a PLAINTEXT column
	// default in drizzle, i.e. plaintext at rest on an INSERT that omits the
	// column); and source-type-only constraints (options/min/max/min-maxLength)
	// which are inert on a text column and already enforced on plaintext by the
	// effective validator.
	const {
		defaultValue: _defaultValue,
		editor: _editor,
		hooks: sourceHooks,
		index: _index,
		max: _max,
		maxLength: _maxLength,
		min: _min,
		minLength: _minLength,
		options: _options,
		typescriptSchema: _ts,
		unique: _unique,
		validate: _validate,
		...rest
	} = source as EncryptedSourceField & Record<string, unknown>

	let stored: TextField = {
		...(rest as unknown as TextField),
		type: 'text',
		...(hasMany ? { hasMany: true } : {}),
		admin: {
			...sourceAdmin,
			components: {
				...(sourceAdmin?.components ?? {}),
				Field: {
					clientProps: { componentKey: source.type, fieldPatch, protection },
					path: '@10x-media/fields/client#ProtectedField',
				},
				...(protection === 'masked'
					? { Cell: { path: '@10x-media/fields/rsc#ProtectedCell' } }
					: {}),
			},
		},
		custom: { ...source.custom, [FIELDS_CUSTOM_KEY]: { encrypted: marker } },
		hooks: {
			...sourceHooks,
			afterRead: [makeAfterReadHook(marker), ...(sourceHooks?.afterRead ?? [])],
			beforeChange: [...(sourceHooks?.beforeChange ?? []), makeBeforeChangeHook(marker)],
		},
		typescriptSchema: typescriptSchemaFor(source),
		validate: makeComposedValidate(effective, hasMany),
	}

	if (overrides) {
		stored = overrides({ field: stored })
	}

	if (!queryable) {
		return [stored]
	}

	const bidx: TextField = {
		name: marker.bidxName as string,
		type: 'text',
		hidden: true,
		index: true,
		...(marker.localized ? { localized: true } : {}),
		...(unique ? { unique: true } : {}),
	}
	return [stored, bidx]
}
