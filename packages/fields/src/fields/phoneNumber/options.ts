import type { GroupField, StaticLabel, TextField } from 'payload'
import type { PhoneNumberGlobalConfig } from '../../types'
import { DEFAULT_METADATA_SET, type MetadataSet } from './engine/metadata'
import type { CountryCode, PhoneFormat, PhoneValidationMode } from './engine/phone'

/** field.custom key the factory stamps its resolved config under, for tooling and secondary apps. */
export const PHONE_CUSTOM_KEY = '@10x-media/fields'

/** Mounted by the plugin; the client builds flag URLs from serverURL + api route + this. */
export const FLAGS_PATH = '/10x-fields/flags'

/**
 * The flag route's URL for one ISO 3166-1 alpha-2 code, built from the app's own API
 * route rather than assumed, so an install that moved `routes.api` still resolves its
 * flags. The `.svg` suffix is there for a reader who opens the URL directly.
 *
 * Lives here, not beside the handler, so the admin client can build a URL without
 * importing the server module and its deferred flag artwork.
 */
export const countryFlagSrc = (serverURL: string, apiRoute: string, code: string): string =>
	`${serverURL}${apiRoute}${FLAGS_PATH}/${encodeURIComponent(code.toLowerCase())}.svg`

export type PhoneFlagMode = 'emoji' | 'none' | 'svg'
export type PhoneStorageMode = 'e164' | 'object'

type CommonPhoneOptions = {
	name: string
	label?: StaticLabel
	required?: boolean
	localized?: boolean
	index?: boolean
	defaultCountry?: CountryCode
	countries?: readonly CountryCode[]
	priorityCountries?: readonly CountryCode[]
	/** Heading over `priorityCountries` in the picker. No label renders no heading, only the group separator. */
	priorityCountriesLabel?: StaticLabel
	validation?: PhoneValidationMode
	flags?: PhoneFlagMode
	cellFormat?: PhoneFormat
	/**
	 * Default true. False means the value cannot be removed, not merely that the clear
	 * affordance is hidden: emptying the input and committing reverts to the last valid value.
	 */
	isClearable?: boolean
}

export type PhoneNumberFieldOptions = CommonPhoneOptions & {
	storage?: 'object'
	overrides?: (args: { field: GroupField }) => GroupField
}

export type PhoneNumberE164FieldOptions = CommonPhoneOptions & {
	storage: 'e164'
	overrides?: (args: { field: TextField }) => TextField
}

export type AnyPhoneNumberFieldOptions = PhoneNumberE164FieldOptions | PhoneNumberFieldOptions

/** Every phone option with its layers merged and its defaults applied. Server-side. */
export type ResolvedPhoneOptions = {
	cellFormat: PhoneFormat
	countries?: readonly CountryCode[]
	defaultCountry?: CountryCode
	flags: PhoneFlagMode
	/** See {@link CommonPhoneOptions.isClearable}. */
	isClearable: boolean
	metadata: MetadataSet
	priorityCountries?: readonly CountryCode[]
	priorityCountriesLabel?: StaticLabel
	storage: PhoneStorageMode
	validation: PhoneValidationMode
}

/** The field's own, unresolved layer: exactly what the author wrote, no defaults applied. */
export type ResolvablePhoneFieldOptions = Pick<
	CommonPhoneOptions,
	| 'cellFormat'
	| 'countries'
	| 'defaultCountry'
	| 'flags'
	| 'isClearable'
	| 'priorityCountries'
	| 'priorityCountriesLabel'
	| 'validation'
> & {
	storage?: PhoneStorageMode
}

/**
 * Field beats global beats these defaults, via `??` so an explicit `undefined`
 * on a field falls through rather than resetting it. `metadata` is global-only;
 * `storage` is field-only, since the factory's return type is fixed at build time
 * and a plugin-wide storage choice could never be honoured.
 */
export const resolvePhoneOptions = (
	field: ResolvablePhoneFieldOptions,
	global: PhoneNumberGlobalConfig | undefined
): ResolvedPhoneOptions => ({
	cellFormat: field.cellFormat ?? global?.cellFormat ?? 'international',
	countries: field.countries ?? global?.countries,
	defaultCountry: field.defaultCountry ?? global?.defaultCountry,
	flags: field.flags ?? global?.flags ?? 'svg',
	isClearable: field.isClearable ?? true,
	metadata: global?.metadata ?? DEFAULT_METADATA_SET,
	priorityCountries: field.priorityCountries ?? global?.priorityCountries,
	priorityCountriesLabel: field.priorityCountriesLabel ?? global?.priorityCountriesLabel,
	storage: field.storage ?? 'object',
	validation: field.validation ?? global?.validation ?? 'valid',
})
