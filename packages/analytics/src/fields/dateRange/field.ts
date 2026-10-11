import type { GroupField } from 'payload'
import { DATE_RANGE_FIELD_COMPONENT } from '../componentPaths'
import type { DateRangeFieldArgs, DateRangeFieldOptions } from './types'

/** Group with hidden `from`/`to` date subfields, rendered as one range picker in the admin. */
export const dateRangeField = (args: DateRangeFieldArgs): GroupField => {
	const {
		name,
		label,
		description,
		required,
		pickerAppearance = 'default',
		timezone = false,
		untilToday = false,
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
					path: DATE_RANGE_FIELD_COMPONENT,
					clientProps: {
						pickerAppearance,
						timezone,
						...(untilToday ? { untilToday } : {}),
					} satisfies DateRangeFieldOptions,
				},
			},
		},
		fields: childFields,
	}

	return typeof overrides === 'function' ? overrides(baseField) : baseField
}
