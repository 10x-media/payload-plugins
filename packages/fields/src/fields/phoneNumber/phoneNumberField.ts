import type {
	FieldHook,
	GroupField,
	SanitizedConfig,
	TextField,
	TextFieldValidation,
	Validate,
} from 'payload'
import { getFieldsRegistry } from '../../plugin/registry'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'
import { isKnownCountry } from './engine/countries'
import { DEFAULT_METADATA_SET, loadMetadata, type MetadataSet } from './engine/metadata'
import { type CountryCode, checkPhone, type PhoneValidationMode, parsePhone } from './engine/phone'
import {
	type AnyPhoneNumberFieldOptions,
	PHONE_CUSTOM_KEY,
	type PhoneNumberE164FieldOptions,
	type PhoneNumberFieldOptions,
	resolvePhoneOptions,
} from './options'

const assertCountries = (opts: {
	countries: readonly CountryCode[] | undefined
	defaultCountry: CountryCode | undefined
	name: string
}): void => {
	const { countries, defaultCountry, name } = opts
	for (const code of countries ?? []) {
		if (!isKnownCountry(code)) {
			throw new Error(
				`phoneNumberField(${name}): countries entry "${code}" is not a supported country`
			)
		}
	}
	if (defaultCountry === undefined) return
	if (!isKnownCountry(defaultCountry)) {
		throw new Error(
			`phoneNumberField(${name}): defaultCountry "${defaultCountry}" is not a supported country`
		)
	}
	if (countries !== undefined && !countries.includes(defaultCountry)) {
		throw new Error(
			`phoneNumberField(${name}): defaultCountry "${defaultCountry}" is not in countries`
		)
	}
}

/**
 * The registry's install-wide metadata choice, read at request time (never at field-build
 * time: the factory runs before the plugin's normalizeRegistry ever sees the config, so it
 * has no other way to observe it). Degrades to the default the same way resolvePrecisionSafe
 * does, for a config mutated after the plugin ran or assembled without it. Shared by validate
 * and the read hook so both parse against the same set the client bag advertises; a mismatch
 * here is how a number the admin UI shows as valid ends up rejected on save.
 */
const resolveMetadataSetSafe = (config: SanitizedConfig): MetadataSet => {
	try {
		return getFieldsRegistry(config)?.phoneNumber?.metadata ?? DEFAULT_METADATA_SET
	} catch {
		return DEFAULT_METADATA_SET
	}
}

const derivedHook: FieldHook = async ({ req, value }) => {
	const stored = (value ?? {}) as { country?: CountryCode; number?: string }
	if (typeof stored.number !== 'string' || stored.number === '') return value
	const parsed = parsePhone(stored.number, {
		defaultCountry: stored.country,
		metadata: await loadMetadata(resolveMetadataSetSafe(req.payload.config)),
	})
	if (!parsed) return value
	// Persisted keys spread first: this hook enriches the group, it never rewrites it.
	return {
		...stored,
		callingCode: parsed.callingCode,
		international: parsed.international,
		national: parsed.national,
		type: parsed.type,
		uri: parsed.uri,
	}
}

const buildValidate =
	(opts: { mode: PhoneValidationMode; required: boolean }): Validate =>
	async (value, args) => {
		const stored = (value ?? {}) as { country?: CountryCode; number?: string }
		const raw = typeof stored.number === 'string' ? stored.number : ''
		const check = checkPhone(raw, opts.mode, {
			defaultCountry: stored.country,
			metadata: await loadMetadata(resolveMetadataSetSafe(args.req.payload.config)),
		})
		if (check === 'empty') {
			return opts.required ? asTranslate(args.req.t)(keys.phoneRequired) : true
		}
		if (check === 'notMobile') return asTranslate(args.req.t)(keys.phoneNotMobile)
		if (check === 'invalid') return asTranslate(args.req.t)(keys.invalidPhoneNumber)
		return true
	}

const buildTextValidate =
	(opts: {
		defaultCountry: CountryCode | undefined
		mode: PhoneValidationMode
		required: boolean
	}): TextFieldValidation =>
	async (value, args) => {
		const raw = typeof value === 'string' ? value : ''
		const check = checkPhone(raw, opts.mode, {
			defaultCountry: opts.defaultCountry,
			metadata: await loadMetadata(resolveMetadataSetSafe(args.req.payload.config)),
		})
		if (check === 'empty') {
			return opts.required ? asTranslate(args.req.t)(keys.phoneRequired) : true
		}
		if (check === 'notMobile') return asTranslate(args.req.t)(keys.phoneNotMobile)
		if (check === 'invalid') return asTranslate(args.req.t)(keys.invalidPhoneNumber)
		return true
	}

/**
 * Group of `number` + `country`, plus a derived-on-read `national`/`international`/
 * `callingCode`/`uri`/`type`. Spread a preset for `e164` storage via `storage: 'e164'`,
 * which trades the country/derived subfields for a single text field holding the raw string.
 */
export function phoneNumberField(options: PhoneNumberE164FieldOptions): TextField
export function phoneNumberField(options: PhoneNumberFieldOptions): GroupField
export function phoneNumberField(options: AnyPhoneNumberFieldOptions): GroupField | TextField {
	const {
		name,
		label,
		required,
		localized,
		index,
		defaultCountry,
		countries,
		preferredCountries,
		validation,
		flags,
		cellFormat,
		isClearable,
	} = options

	assertCountries({ countries, defaultCountry, name })

	const clientOptions = resolvePhoneOptions(
		{
			cellFormat,
			countries,
			defaultCountry,
			flags,
			isClearable,
			preferredCountries,
			storage: options.storage,
			validation,
		},
		undefined
	)

	if (options.storage === 'e164') {
		const base: TextField = {
			name,
			type: 'text',
			...(label !== undefined ? { label } : {}),
			...(required !== undefined ? { required } : {}),
			...(localized !== undefined ? { localized } : {}),
			...(index !== undefined ? { index } : {}),
			admin: {
				components: {
					Cell: {
						clientProps: { phoneOptions: clientOptions },
						path: '@10x-media/fields/rsc#PhoneNumberCellServer',
					},
					Field: {
						clientProps: { phoneOptions: clientOptions },
						path: '@10x-media/fields/rsc#PhoneNumberFieldServer',
					},
				},
			},
			custom: { [PHONE_CUSTOM_KEY]: clientOptions },
			validate: buildTextValidate({
				defaultCountry,
				mode: clientOptions.validation,
				required: required ?? false,
			}),
		}
		return typeof options.overrides === 'function' ? options.overrides({ field: base }) : base
	}

	const base: GroupField = {
		name,
		type: 'group',
		...(label !== undefined ? { label } : {}),
		...(required !== undefined ? { required } : {}),
		...(localized !== undefined ? { localized } : {}),
		...(index !== undefined ? { index } : {}),
		admin: {
			components: {
				Cell: {
					clientProps: { phoneOptions: clientOptions },
					path: '@10x-media/fields/rsc#PhoneNumberCellServer',
				},
				Field: {
					clientProps: { phoneOptions: clientOptions },
					path: '@10x-media/fields/rsc#PhoneNumberFieldServer',
				},
			},
		},
		custom: { [PHONE_CUSTOM_KEY]: clientOptions },
		fields: [
			{ admin: { disableListColumn: true }, name: 'number', type: 'text' },
			{ admin: { disableListColumn: true }, name: 'country', type: 'text' },
			{ admin: { disableListColumn: true }, name: 'national', type: 'text', virtual: true },
			{ admin: { disableListColumn: true }, name: 'international', type: 'text', virtual: true },
			{ admin: { disableListColumn: true }, name: 'callingCode', type: 'text', virtual: true },
			{ admin: { disableListColumn: true }, name: 'uri', type: 'text', virtual: true },
			{ admin: { disableListColumn: true }, name: 'type', type: 'text', virtual: true },
		],
		hooks: { afterRead: [derivedHook] },
		validate: buildValidate({
			mode: clientOptions.validation,
			required: required ?? false,
		}),
	}

	return typeof options.overrides === 'function' ? options.overrides({ field: base }) : base
}
