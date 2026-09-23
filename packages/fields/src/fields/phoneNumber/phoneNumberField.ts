import type { FieldHook, GroupField, TextField, TextFieldValidation, Validate } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'
import { isKnownCountry } from './engine/countries'
import { loadMetadata } from './engine/metadata'
import { type CountryCode, checkPhone, parsePhone } from './engine/phone'
import {
	type AnyPhoneNumberFieldOptions,
	PHONE_CUSTOM_KEY,
	type PhoneNumberE164FieldOptions,
	type PhoneNumberFieldOptions,
	type ResolvablePhoneFieldOptions,
} from './options'
import { resolvePhoneOptionsSafe } from './server/resolvePhoneOptionsSafe'

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

/** Configuration errors return a message rather than throw: writes must fail either way. */
const mobileMetadataMismatch = (name: string): string =>
	`phoneNumberField(${name}): validation "mobile" requires metadata "max" or "mobile", but this install is configured "min"`

const buildDerivedHook =
	(fieldLayer: ResolvablePhoneFieldOptions): FieldHook =>
	async ({ req, value }) => {
		const stored = (value ?? {}) as { country?: CountryCode; number?: string }
		if (typeof stored.number !== 'string' || stored.number === '') return value
		const resolved = resolvePhoneOptionsSafe({ fieldOptions: fieldLayer, payload: req.payload })
		const parsed = parsePhone(stored.number, {
			defaultCountry: stored.country,
			metadata: await loadMetadata(resolved.metadata),
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
	(opts: { fieldLayer: ResolvablePhoneFieldOptions; name: string; required: boolean }): Validate =>
	async (value, args) => {
		const stored = (value ?? {}) as { country?: CountryCode; number?: string }
		const raw = typeof stored.number === 'string' ? stored.number : ''
		const resolved = resolvePhoneOptionsSafe({
			fieldOptions: opts.fieldLayer,
			payload: args.req.payload,
		})
		const check = checkPhone(raw, resolved.validation, {
			defaultCountry: stored.country,
			metadata: await loadMetadata(resolved.metadata),
		})
		if (check === 'empty') {
			return opts.required ? asTranslate(args.req.t)(keys.phoneRequired) : true
		}
		if (check === 'notMobile') {
			if (resolved.validation === 'mobile' && resolved.metadata === 'min') {
				return mobileMetadataMismatch(opts.name)
			}
			return asTranslate(args.req.t)(keys.phoneNotMobile)
		}
		if (check === 'invalid') return asTranslate(args.req.t)(keys.invalidPhoneNumber)
		return true
	}

const buildTextValidate =
	(opts: {
		fieldLayer: ResolvablePhoneFieldOptions
		name: string
		required: boolean
	}): TextFieldValidation =>
	async (value, args) => {
		const raw = typeof value === 'string' ? value : ''
		const resolved = resolvePhoneOptionsSafe({
			fieldOptions: opts.fieldLayer,
			payload: args.req.payload,
		})
		const check = checkPhone(raw, resolved.validation, {
			defaultCountry: resolved.defaultCountry,
			metadata: await loadMetadata(resolved.metadata),
		})
		if (check === 'empty') {
			return opts.required ? asTranslate(args.req.t)(keys.phoneRequired) : true
		}
		if (check === 'notMobile') {
			if (resolved.validation === 'mobile' && resolved.metadata === 'min') {
				return mobileMetadataMismatch(opts.name)
			}
			return asTranslate(args.req.t)(keys.phoneNotMobile)
		}
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
		priorityCountries,
		priorityCountriesLabel,
		validation,
		flags,
		cellFormat,
		isClearable,
	} = options

	assertCountries({ countries, defaultCountry, name })

	// The field's own options, exactly as written, with no defaults applied: registry
	// defaults are only visible at request time, via resolvePhoneOptionsSafe below.
	const fieldLayer: ResolvablePhoneFieldOptions = {
		...(cellFormat !== undefined ? { cellFormat } : {}),
		...(countries !== undefined ? { countries } : {}),
		...(defaultCountry !== undefined ? { defaultCountry } : {}),
		...(flags !== undefined ? { flags } : {}),
		...(isClearable !== undefined ? { isClearable } : {}),
		...(priorityCountries !== undefined ? { priorityCountries } : {}),
		...(priorityCountriesLabel !== undefined ? { priorityCountriesLabel } : {}),
		...(options.storage !== undefined ? { storage: options.storage } : {}),
		...(validation !== undefined ? { validation } : {}),
	}

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
						clientProps: { phoneOptions: fieldLayer },
						path: '@10x-media/fields/rsc#PhoneNumberCellServer',
					},
					Field: {
						clientProps: { phoneOptions: fieldLayer },
						path: '@10x-media/fields/rsc#PhoneNumberFieldServer',
					},
				},
			},
			custom: { [PHONE_CUSTOM_KEY]: fieldLayer },
			validate: buildTextValidate({ fieldLayer, name, required: required ?? false }),
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
					clientProps: { phoneOptions: fieldLayer },
					path: '@10x-media/fields/rsc#PhoneNumberCellServer',
				},
				Field: {
					clientProps: { phoneOptions: fieldLayer },
					path: '@10x-media/fields/rsc#PhoneNumberFieldServer',
				},
			},
		},
		custom: { [PHONE_CUSTOM_KEY]: fieldLayer },
		fields: [
			{ admin: { disableListColumn: true }, name: 'number', type: 'text' },
			{ admin: { disableListColumn: true }, name: 'country', type: 'text' },
			{ admin: { disableListColumn: true }, name: 'national', type: 'text', virtual: true },
			{ admin: { disableListColumn: true }, name: 'international', type: 'text', virtual: true },
			{ admin: { disableListColumn: true }, name: 'callingCode', type: 'text', virtual: true },
			{ admin: { disableListColumn: true }, name: 'uri', type: 'text', virtual: true },
			{ admin: { disableListColumn: true }, name: 'type', type: 'text', virtual: true },
		],
		hooks: { afterRead: [buildDerivedHook(fieldLayer)] },
		validate: buildValidate({ fieldLayer, name, required: required ?? false }),
	}

	return typeof options.overrides === 'function' ? options.overrides({ field: base }) : base
}
