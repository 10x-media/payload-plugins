import { keys } from '../../translations/keys'
import { COUNTRIES, countryLabel, isCountryCode } from '../data/regions'
import { defineFormField } from '../defineFormField'

/**
 * A country picker fronted by the fixed ISO 3166-1 alpha-2 set (see {@link COUNTRIES}). Unlike
 * `select` the author does not author options, so there is no `config`; the stored value is the
 * two-letter code and `format` resolves it to the English name. `resolveOptions` exposes the same
 * set as poll choices so a country field can back a poll despite carrying no authored options.
 */
export const countryField = defineFormField<'text'>({
	type: 'country',
	label: keys.fieldTypeCountry,
	value: 'text',
	conditionType: 'select',
	pollEligible: true,
	resolveOptions: () => COUNTRIES,
	validate: ({ value, t }) => {
		if (value == null || value === '') {
			return true
		}
		return isCountryCode(value) ? true : t(keys.validationCountry)
	},
	format: ({ value }) => {
		if (value == null || value === '') {
			return ''
		}
		return countryLabel(value) ?? String(value)
	},
})
