import { keys } from '../../translations/keys'
import { isUsStateCode, US_STATES, usStateLabel } from '../data/regions'
import { defineFormField } from '../defineFormField'

/**
 * A US state/DC picker fronted by the fixed USPS-code set (see {@link US_STATES}), scoped US-only to
 * match native's `state` block. Like `country` the author authors no options; the stored value is the
 * state code and `format` resolves it to the state name. `resolveOptions` exposes the set as poll
 * choices so a state field can back a poll despite carrying no authored options.
 */
export const stateField = defineFormField<'text'>({
	type: 'state',
	label: keys.fieldTypeState,
	value: 'text',
	conditionType: 'select',
	pollEligible: true,
	resolveOptions: () => US_STATES,
	validate: ({ value, t }) => {
		if (value == null || value === '') {
			return true
		}
		return isUsStateCode(value) ? true : t(keys.validationState)
	},
	format: ({ value }) => {
		if (value == null || value === '') {
			return ''
		}
		return usStateLabel(value) ?? String(value)
	},
})
