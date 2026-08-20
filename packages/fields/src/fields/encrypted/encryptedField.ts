import type { CheckboxField, Field, RichTextField, TextField } from 'payload'
import { validateKeysConfig } from './crypto/keys'
import { normalizeGenerate } from './generateSecret'
import { normalizeHint } from './hint'
import {
	makeAfterReadHook,
	makeBeforeChangeHook,
	makeRichTextCiphertextHook,
	makeRichTextDecryptHook,
	makeRichTextSealHook,
	makeRichTextValidate,
	makeSetIndicatorHook,
} from './hooks'
import { clampMaskDots } from './maskDots'
import {
	type EncryptedFieldMarker,
	type EncryptedFieldOptions,
	type EncryptedFieldPatch,
	type EncryptedProtection,
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
 * Emits the two-field pair for an encrypted richText source: a real, virtual
 * (never persisted) richText field carrying the app's full editor for editing,
 * synced by hooks to a hidden ciphertext text sibling that holds the data at
 * rest. A `type:'text'` field cannot trigger Payload's richText schema/import-map
 * pipeline, so a real richText field is required for full node parity; `virtual`
 * keeps its plaintext out of both DB adapters (they skip virtual fields).
 */
const buildRichTextFields = (args: {
	marker: EncryptedFieldMarker
	protection: EncryptedProtection
	source: RichTextField
}): Field[] => {
	const { marker, protection, source } = args
	const storedName = `${source.name}_encrypted`
	const sourceAdmin = source.admin ?? {}
	const virtual: RichTextField = {
		...source,
		// editor is inherited from config.editor (or source.editor if pinned) so the
		// app's complete node set mounts; readOnly:false is required or sanitize
		// forces a virtual affectsData field readOnly.
		admin: {
			...sourceAdmin,
			components: {
				...sourceAdmin.components,
				...(protection === 'masked'
					? {
							Field: {
								path: '@10x-media/fields/rsc#ProtectedRichText',
								serverProps: { protection },
							},
						}
					: {}),
			},
			readOnly: false,
		},
		hooks: {
			...source.hooks,
			afterRead: [makeRichTextDecryptHook(marker, storedName), ...(source.hooks?.afterRead ?? [])],
			beforeChange: [
				...(source.hooks?.beforeChange ?? []),
				makeRichTextSealHook(marker, storedName),
			],
		},
		type: 'richText',
		validate: makeRichTextValidate(),
		virtual: true,
	}
	const ciphertext: TextField = {
		name: storedName,
		type: 'text',
		// admin.hidden (not top-level hidden) keeps the value readable by the virtual
		// field's decrypt hook; top-level hidden strips it early in afterRead and
		// races the decrypt read.
		admin: { disableListColumn: true, disableListFilter: true, hidden: true },
		custom: { [FIELDS_CUSTOM_KEY]: { encrypted: marker } },
		hooks: { beforeChange: [makeRichTextCiphertextHook(marker)] },
		...(marker.localized ? { localized: true } : {}),
	}
	return [virtual, ciphertext]
}

/**
 * Wraps a Payload field config (text, textarea, email, number, checkbox,
 * date, select, radio, code, json, point, richText) in transparent AES-256-GCM
 * encryption at rest. Returns `[storedField]`, or `[storedField, bidxField]`
 * when `queryable` adds a blind-index sibling; richText returns
 * `[virtualEditorField, ciphertextField]`. Spread into `fields: [...]`.
 */
export const encryptedField = (
	source: EncryptedSourceField,
	options: EncryptedFieldOptions = {}
): Field[] => {
	const {
		clearable,
		generate,
		hint,
		keys,
		maskDots: maskDotsOption,
		onDecryptFailure,
		overrides,
		protection = 'masked',
		queryable = false,
	} = options
	const maskDots = clampMaskDots(maskDotsOption)
	const writeOnly = protection === 'writeOnly'
	if (keys) {
		validateKeysConfig(keys)
	}
	const hasMany = 'hasMany' in source && source.hasMany === true
	const unique = 'unique' in source && source.unique === true
	const required = 'required' in source && source.required === true
	if (!writeOnly && (hint || generate || clearable !== undefined)) {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': hint, generate, and clearable require protection 'writeOnly'`
		)
	}
	if (hint && hasMany) {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': hint is not supported with hasMany (one hint cannot identify many values)`
		)
	}
	if (hint && source.type !== 'text' && source.type !== 'email') {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': hint is only supported for text and email fields (a hint slices leading/trailing characters)`
		)
	}
	if (generate && source.type !== 'text') {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': generate is only supported for text fields`
		)
	}
	if (clearable === true && required) {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': clearable cannot be enabled on a required field (clearing it could never save)`
		)
	}
	const normalizedHint = hint ? normalizeHint(hint, source.name) : undefined
	const normalizedGenerate = generate ? normalizeGenerate(generate, source.name) : undefined
	const resolvedClearable = writeOnly ? (clearable ?? !required) : false
	if (writeOnly && queryable) {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': protection 'writeOnly' cannot be combined with queryable (the blind index is an equality oracle: anyone with list access could probe guesses of the secret)`
		)
	}
	if (writeOnly && source.type === 'richText') {
		throw new Error(
			`@10x-media/fields: encryptedField '${source.name}': protection 'writeOnly' is not supported for richText (editing rich text requires the client to see it; use 'masked' instead)`
		)
	}
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

	const marker: EncryptedFieldMarker = {
		bidxName: queryable ? `${source.name}_bidx` : undefined,
		fieldName: source.name,
		hasMany,
		keys,
		localized: 'localized' in source && source.localized === true,
		normalize: source.type === 'email' ? 'email' : 'standard',
		onDecryptFailure,
		queryable,
		setName: writeOnly ? `${source.name}_set` : undefined,
		hint: normalizedHint,
		hintName: normalizedHint ? `${source.name}_hint` : undefined,
		sourceType: source.type,
		writeOnly,
	}

	// richText returns a virtual editor field plus a hidden ciphertext sibling.
	// `overrides` targets the scalar stored text column shape, so it does not apply
	// to the richText editor field and is intentionally skipped here.
	if (source.type === 'richText') {
		return buildRichTextFields({ marker, protection, source })
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
			// A non-queryable encrypted field can only ever filter its ciphertext
			// column (matching nothing), so keep it out of the list filter UI. A
			// queryable field stays filterable; the where-rewrite maps it to the
			// blind index.
			...(queryable ? {} : { disableListFilter: true }),
			components: {
				...(sourceAdmin?.components ?? {}),
				Field: {
					clientProps: {
						componentKey: source.type,
						fieldPatch,
						maskDots,
						protection,
						...(writeOnly
							? {
									clearable: resolvedClearable,
									...(normalizedGenerate ? { generate: normalizedGenerate } : {}),
								}
							: {}),
					},
					path: '@10x-media/fields/client#ProtectedField',
				},
				...(protection !== 'none'
					? {
							Cell: {
								clientProps: {
									maskDots,
									...(writeOnly ? { setName: marker.setName } : {}),
									...(marker.hintName ? { hintName: marker.hintName } : {}),
								},
								path: '@10x-media/fields/rsc#ProtectedCell',
							},
						}
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
		validate: makeComposedValidate(effective),
	}

	if (overrides) {
		stored = overrides({ field: stored })
	}

	// Write-only reads strip the stored field from every response, so the admin
	// (and any API consumer) learns set-ness from this virtual sibling instead: a
	// never-persisted checkbox computed from the sealed sibling's presence. This
	// is the mode's one deliberate leak, existence only. admin.hidden keeps it in
	// form state (Payload renders it as a hidden input) without displaying it.
	if (writeOnly) {
		const setField: CheckboxField = {
			name: marker.setName as string,
			type: 'checkbox',
			admin: { disableListColumn: true, disableListFilter: true, hidden: true },
			hooks: { afterRead: [makeSetIndicatorHook(marker.fieldName)] },
			virtual: true,
		}
		if (!marker.hintName) {
			return [stored, setField]
		}
		// The hint is real stored data (derived at seal time in the same
		// beforeChange that encrypts, so the two can never drift) and is the
		// identification surface API consumers and the admin read; it is
		// deliberately NOT stripped from responses.
		const hintField: TextField = {
			name: marker.hintName,
			type: 'text',
			admin: { disableListColumn: true, disableListFilter: true, hidden: true },
			...(marker.localized ? { localized: true } : {}),
		}
		return [stored, setField, hintField]
	}

	if (!queryable) {
		return [stored]
	}

	// admin.hidden (not top-level `hidden: true`) keeps the blind index in the
	// flattened schema so Payload's query-path validation grants it read
	// permission and the where-rewrite can target it; top-level hidden makes a
	// rewritten `equals` query fail with a 403. The keyed hash is stripped from
	// API responses by the plugin's collection afterRead (see withEncryptedQueryRewrite)
	// so the index value never leaves the server; exposing it lets a reader see
	// which rows share a value.
	const bidx: TextField = {
		name: marker.bidxName as string,
		type: 'text',
		admin: { disableListColumn: true, disableListFilter: true, hidden: true },
		index: true,
		...(marker.localized ? { localized: true } : {}),
		...(unique ? { unique: true } : {}),
	}
	return [stored, bidx]
}
