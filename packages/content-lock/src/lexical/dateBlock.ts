import type { Block } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export const DATE_BLOCK_SLUG = 'contentLockDate'

/** How a date inline block renders for the viewer. */
export type DateFormat = 'datetime' | 'date' | 'time' | 'relative'

/**
 * Where a date inline block takes its instant from: one of the window's own
 * timestamps, resolved when the banner renders, or a fixed date.
 */
export type DateSource = 'startsAt' | 'endsAt' | 'announceAt' | 'custom'

/**
 * An inline date in a lock message. Pointing it at the window's start or end
 * keeps the text right when the window is rescheduled, with no retranslation.
 * Every viewer sees it in their own time zone and locale.
 */
export const dateBlock: Block = {
	slug: DATE_BLOCK_SLUG,
	labels: {
		singular: labelForKey(keys.dateBlockLabel),
		plural: labelForKey(keys.dateBlockLabel),
	},
	fields: [
		{
			name: 'source',
			type: 'select',
			defaultValue: 'startsAt',
			required: true,
			label: labelForKey(keys.dateBlockSource),
			options: [
				{ value: 'startsAt', label: labelForKey(keys.sourceStartsAt) },
				{ value: 'endsAt', label: labelForKey(keys.sourceEndsAt) },
				{ value: 'announceAt', label: labelForKey(keys.sourceAnnounceAt) },
				{ value: 'custom', label: labelForKey(keys.sourceCustom) },
			],
		},
		{
			name: 'date',
			type: 'date',
			label: labelForKey(keys.dateBlockDate),
			admin: {
				date: { pickerAppearance: 'dayAndTime' },
				condition: (_data, siblingData) => siblingData?.source === 'custom',
			},
			validate: (value, { siblingData, req }) =>
				(siblingData as { source?: string }).source === 'custom' && !value
					? req.t('validation:required')
					: true,
		},
		{
			name: 'format',
			type: 'select',
			defaultValue: 'datetime',
			required: true,
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
