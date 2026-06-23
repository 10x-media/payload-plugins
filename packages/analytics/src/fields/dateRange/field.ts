import type { GroupField } from 'payload'
import type { DateRangeFieldArgs } from './types'

/**
 * Utility to create a Date Range field: a group with `from` / `to` date subfields
 * rendered as a single range picker in the admin UI.
 *
 * @example
 * ```ts
 * dateRangeField({
 *   name: 'eventDates',
 *   label: 'Event Dates',
 *   pickerAppearance: 'dayOnly',
 *   timezone: true,
 * })
 * ```
 */
export const dateRangeField = (args: DateRangeFieldArgs): GroupField => {
	const {
		name,
		label,
		description,
		required,
		pickerAppearance = 'default',
		timezone = false,
		overrides,
	} = args

	const childFields: GroupField['fields'] = [
		{
			name: 'from',
			type: 'date',
			admin: { hidden: true },
		},
		{
			name: 'to',
			type: 'date',
			admin: { hidden: true },
		},
	]

	if (timezone) {
		childFields.push({
			name: '_tz',
			type: 'text',
			admin: { hidden: true },
		})
	}

	const baseField: GroupField = {
		name,
		type: 'group',
		label: label ?? false,
		required,
		admin: {
			description,
			components: {
				Field: {
					path: '@10x-media/analytics/client#DateRangeField',
					clientProps: {
						pickerAppearance,
						timezone,
					} satisfies import('./types').DateRangeFieldOptions,
				},
			},
		},
		fields: childFields,
	}

	if (typeof overrides === 'function') {
		return overrides(baseField)
	}

	return baseField
}
