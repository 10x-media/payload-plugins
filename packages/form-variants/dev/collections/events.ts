import type { CollectionConfig } from 'payload'

import { defineFormVariants } from '../../src/index'

/**
 * Two variants of our own and no native form for anyone. A new event opens the guided
 * `wizard`, whose venue or stream step depends on the format chosen in the first step; an
 * existing one opens `edit`, which works as tabs and saves on any step. Switching between the
 * two keeps every value, since they share one form.
 */
export const events: CollectionConfig = {
	slug: 'events',
	admin: { defaultColumns: ['title', 'format', 'startsAt'], useAsTitle: 'title' },
	custom: {
		formVariants: defineFormVariants('events', {
			defaultVariant: ({ operation }) => (operation === 'create' ? 'wizard' : 'edit'),
			variants: [
				{
					key: 'wizard',
					label: 'Guided',
					steps: [
						{
							key: 'basics',
							label: 'Basics',
							description: 'The next step depends on the format.',
							fields: ['title', 'format', 'startsAt', 'endsAt'],
						},
						{
							key: 'venue',
							label: 'Venue',
							condition: ({ values }) => values.format !== 'online',
							fields: ['venue.name', 'venue.street', 'venue.city'],
						},
						{
							key: 'stream',
							label: 'Stream',
							condition: ({ values }) => values.format === 'online',
							fields: ['url'],
						},
						{
							key: 'program',
							label: 'Program',
							fields: [
								{ type: 'component', Component: './components/ProgramHint#ProgramHint' },
								'sessions',
								'summary',
							],
						},
					],
				},
				{
					key: 'edit',
					label: 'Sections',
					navigation: 'free',
					save: 'always',
					steps: [
						{
							key: 'basics',
							label: 'Basics',
							fields: ['title', 'format', 'startsAt', 'endsAt', 'url'],
						},
						{
							key: 'venue',
							label: 'Venue',
							condition: ({ values }) => values.format !== 'online',
							fields: ['venue'],
						},
						{ key: 'program', label: 'Program', fields: ['sessions', 'summary'] },
					],
				},
				{ key: 'native', access: () => false },
			],
		}),
	},
	fields: [
		{ name: 'title', type: 'text', required: true },
		{
			name: 'format',
			type: 'select',
			defaultValue: 'in-person',
			options: [
				{ label: 'In person', value: 'in-person' },
				{ label: 'Online', value: 'online' },
			],
			required: true,
		},
		{
			type: 'row',
			fields: [
				{
					name: 'startsAt',
					type: 'date',
					admin: { date: { pickerAppearance: 'dayAndTime' } },
					required: true,
				},
				{ name: 'endsAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
			],
		},
		{
			name: 'url',
			label: 'Stream URL',
			type: 'text',
			admin: { condition: (data) => data?.format === 'online' },
		},
		{
			name: 'venue',
			type: 'group',
			fields: [
				{ name: 'name', type: 'text' },
				{ name: 'street', type: 'text' },
				{ name: 'city', type: 'text' },
			],
		},
		{
			name: 'sessions',
			type: 'array',
			fields: [
				{ name: 'title', type: 'text', required: true },
				{ name: 'speaker', type: 'text' },
				{ name: 'minutes', type: 'number', min: 5 },
			],
		},
		{ name: 'summary', type: 'textarea' },
	],
}
