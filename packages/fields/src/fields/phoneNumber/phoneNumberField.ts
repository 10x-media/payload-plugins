import type { FieldHook, GroupField, TextField, TextFieldValidation, Validate } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'
import { loadMetadata, type MetadataSet } from './engine/metadata'
import { type CountryCode, checkPhone, type PhoneValidationMode, parsePhone } from './engine/phone'
import {
	type AnyPhoneNumberFieldOptions,
	PHONE_CUSTOM_KEY,
	type PhoneNumberE164FieldOptions,
	type PhoneNumberFieldOptions,
	resolvePhoneOptions,
} from './options'

/**
 * Mirrors libphonenumber-js's CountryCode union. Real metadata only loads async, but the
 * eager guards below run synchronously at config-build time, so they cannot await it.
 */
const KNOWN_COUNTRY_CODES = new Set<string>(
	(
		'AC AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR ' +
		'BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC ' +
		'EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK ' +
		'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB ' +
		'LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY ' +
		'MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS ' +
		'RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA TC TD TG TH TJ TK TL ' +
		'TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
	).split(' ')
)

const assertCountries = (opts: {
	countries: readonly CountryCode[] | undefined
	defaultCountry: CountryCode | undefined
	name: string
}): void => {
	const { countries, defaultCountry, name } = opts
	for (const code of countries ?? []) {
		if (!KNOWN_COUNTRY_CODES.has(code)) {
			throw new Error(
				`phoneNumberField(${name}): countries entry "${code}" is not a supported country`
			)
		}
	}
	if (defaultCountry === undefined) return
	if (!KNOWN_COUNTRY_CODES.has(defaultCountry)) {
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

const buildDerivedHook =
	(metadataSet: MetadataSet): FieldHook =>
	async ({ value }) => {
		const stored = (value ?? {}) as { country?: CountryCode; number?: string }
		if (typeof stored.number !== 'string' || stored.number === '') return value
		const parsed = parsePhone(stored.number, {
			defaultCountry: stored.country,
			metadata: await loadMetadata(metadataSet),
		})
		if (!parsed) return value
		// Persisted keys spread first: this hook enriches the group, it never rewrites it.
		return {
			...stored,
			callingCode: parsed.callingCode,
			international: parsed.international,
			national: parsed.national,
			uri: parsed.uri,
			// 'min'/'mobile' metadata carries no type patterns; a stray undefined would be
			// worse than the key being absent, so only 'max' ever adds it.
			...(metadataSet === 'max' ? { type: parsed.type } : {}),
		}
	}

const buildValidate =
	(opts: { metadataSet: MetadataSet; mode: PhoneValidationMode; required: boolean }): Validate =>
	async (value, args) => {
		const stored = (value ?? {}) as { country?: CountryCode; number?: string }
		const raw = typeof stored.number === 'string' ? stored.number : ''
		const check = checkPhone(raw, opts.mode, {
			defaultCountry: stored.country,
			metadata: await loadMetadata(opts.metadataSet),
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
		metadataSet: MetadataSet
		mode: PhoneValidationMode
		required: boolean
	}): TextFieldValidation =>
	async (value, args) => {
		const raw = typeof value === 'string' ? value : ''
		const check = checkPhone(raw, opts.mode, {
			defaultCountry: opts.defaultCountry,
			metadata: await loadMetadata(opts.metadataSet),
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
	const metadataSet = clientOptions.metadata

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
				metadataSet,
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
			...(metadataSet === 'max'
				? [
						{
							admin: { disableListColumn: true },
							name: 'type',
							type: 'text',
							virtual: true,
						} as const,
					]
				: []),
		],
		hooks: { afterRead: [buildDerivedHook(metadataSet)] },
		validate: buildValidate({
			metadataSet,
			mode: clientOptions.validation,
			required: required ?? false,
		}),
	}

	return typeof options.overrides === 'function' ? options.overrides({ field: base }) : base
}
