import type { Block } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export const DATE_BLOCK_SLUG = 'contentLockDate'

/** How a date inline block renders for the viewer. */
export type DateFormat = 'datetime' | 'date' | 'time' | 'relative'

/**
 * An inline date in a lock message. Stored as an instant; every viewer sees it
 * in their own time zone and locale.
 */
export const dateBlock: Block = {
	slug: DATE_BLOCK_SLUG,
	labels: {
		singular: labelForKey(keys.dateBlockLabel),
		plural: labelForKey(keys.dateBlockLabel),
	},
	fields: [
		{
			name: 'date',
			type: 'date',
			required: true,
			label: labelForKey(keys.dateBlockDate),
			admin: { date: { pickerAppearance: 'dayAndTime' } },
		},
		{
			name: 'format',
			type: 'select',
			defaultValue: 'datetime',
			label: labelForKey(keys.dateBlockFormat),
			options: [
				{ value: 'datetime', label: labelForKey(keys.formatDatetime) },
				{ value: 'date', label: labelForKey(keys.formatDate) },
				{ value: 'time', label: labelForKey(keys.formatTime) },
				{ value: 'relative', label: labelForKey(keys.formatRelative) },
			],
		},
	],
}
