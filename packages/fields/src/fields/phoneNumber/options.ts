import type { GroupField, StaticLabel, TextField } from 'payload'
import type { PhoneNumberGlobalConfig } from '../../types'
import { DEFAULT_METADATA_SET, type MetadataSet } from './engine/metadata'
import type { CountryCode, PhoneFormat, PhoneValidationMode } from './engine/phone'

/** field.custom key the factory stamps its resolved config under, for tooling and secondary apps. */
export const PHONE_CUSTOM_KEY = '@10x-media/fields'

/** Mounted by the plugin; the client builds flag URLs from serverURL + api route + this. */
export const FLAGS_PATH = '/10x-fields/flags'

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
	preferredCountries?: readonly CountryCode[]
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

/** Serializable subset shipped to the admin client via clientProps. */
export type PhoneClientOptions = {
	cellFormat: PhoneFormat
	countries?: readonly CountryCode[]
	defaultCountry?: CountryCode
	flags: PhoneFlagMode
	isClearable: boolean
	metadata: MetadataSet
	preferredCountries?: readonly CountryCode[]
	storage: PhoneStorageMode
	validation: PhoneValidationMode
}

type ResolvablePhoneFieldOptions = Pick<
	CommonPhoneOptions,
	| 'cellFormat'
	| 'countries'
	| 'defaultCountry'
	| 'flags'
	| 'isClearable'
	| 'preferredCountries'
	| 'validation'
> & {
	storage?: PhoneStorageMode
}

/**
 * Field beats global beats these defaults, via `??` so an explicit `undefined`
 * on a field falls through rather than resetting it. `metadata` is global-only.
 */
export const resolvePhoneOptions = (
	field: ResolvablePhoneFieldOptions,
	global: PhoneNumberGlobalConfig | undefined
): PhoneClientOptions => ({
	cellFormat: field.cellFormat ?? global?.cellFormat ?? 'international',
	countries: field.countries ?? global?.countries,
	defaultCountry: field.defaultCountry ?? global?.defaultCountry,
	flags: field.flags ?? global?.flags ?? 'svg',
	isClearable: field.isClearable ?? true,
	metadata: global?.metadata ?? DEFAULT_METADATA_SET,
	preferredCountries: field.preferredCountries ?? global?.preferredCountries,
	storage: field.storage ?? global?.storage ?? 'object',
	validation: field.validation ?? global?.validation ?? 'valid',
})
