import type { CollectionConfig } from 'payload'

const options = [
	{ label: 'Alpha', value: 'alpha' },
	{ label: 'Beta', value: 'beta' },
	{ label: 'Gamma', value: 'gamma' },
]

/**
 * Native Payload fields only, in the states the plugin's fields have to match: the visual
 * reference for the Payload 4 admin design, kept next to the field showcases.
 */
export const reference: CollectionConfig = {
	slug: 'reference',
	labels: { plural: 'Reference', singular: 'Reference' },
	admin: {
		defaultColumns: ['title', 'select', 'checkbox', 'date'],
		description: 'Native Payload fields, as a design reference for the custom fields.',
		useAsTitle: 'title',
	},
	fields: [
		{ name: 'title', type: 'text', required: true },
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Text',
					fields: [
						{
							name: 'text',
							type: 'text',
							admin: {
								description: 'Plain text with a description and placeholder.',
								placeholder: 'Type here',
							},
						},
						{ name: 'textRequired', type: 'text', required: true },
						{
							name: 'textReadOnly',
							type: 'text',
							admin: { readOnly: true },
							defaultValue: 'Read only',
						},
						{ name: 'textLocalized', type: 'text', localized: true },
						{ name: 'textHasMany', type: 'text', hasMany: true },
						{
							type: 'row',
							fields: [
								{ name: 'textHalf', type: 'text', admin: { width: '50%' } },
								{ name: 'emailHalf', type: 'email', admin: { width: '50%' } },
							],
						},
						{ name: 'email', type: 'email' },
						{ name: 'textarea', type: 'textarea' },
						{
							name: 'textareaReadOnly',
							type: 'textarea',
							admin: { readOnly: true },
							defaultValue: 'Read only',
						},
						{ name: 'code', type: 'code', admin: { language: 'typescript' } },
						{ name: 'json', type: 'json' },
						{ name: 'richText', type: 'richText' },
					],
				},
				{
					label: 'Numbers and dates',
					fields: [
						{ name: 'number', type: 'number' },
						{ name: 'numberHasMany', type: 'number', hasMany: true },
						{ name: 'numberReadOnly', type: 'number', admin: { readOnly: true }, defaultValue: 42 },
						{
							type: 'row',
							fields: [
								{ name: 'numberMin', type: 'number', min: 0, max: 10, admin: { width: '50%' } },
								{ name: 'numberStep', type: 'number', admin: { step: 0.5, width: '50%' } },
							],
						},
						{ name: 'date', type: 'date' },
						{
							name: 'dateTime',
							type: 'date',
							admin: { date: { pickerAppearance: 'dayAndTime' } },
						},
						{ name: 'timeOnly', type: 'date', admin: { date: { pickerAppearance: 'timeOnly' } } },
						{ name: 'monthOnly', type: 'date', admin: { date: { pickerAppearance: 'monthOnly' } } },
						{ name: 'dateTimezone', type: 'date', timezone: true },
						{ name: 'point', type: 'point' },
					],
				},
				{
					label: 'Choices',
					fields: [
						{ name: 'select', type: 'select', options },
						{ name: 'selectHasMany', type: 'select', hasMany: true, options },
						{ name: 'selectRequired', type: 'select', options, required: true },
						{
							name: 'selectReadOnly',
							type: 'select',
							options,
							admin: { readOnly: true },
							defaultValue: 'beta',
						},
						{ name: 'radio', type: 'radio', options },
						{
							name: 'radioHorizontal',
							type: 'radio',
							options,
							admin: { layout: 'horizontal' },
						},
						{ name: 'checkbox', type: 'checkbox' },
						{
							name: 'checkboxReadOnly',
							type: 'checkbox',
							admin: { readOnly: true },
							defaultValue: true,
						},
						{ name: 'relationship', type: 'relationship', relationTo: 'tenants' },
						{
							name: 'relationshipHasMany',
							type: 'relationship',
							relationTo: 'tenants',
							hasMany: true,
						},
						{
							name: 'relationshipPolymorphic',
							type: 'relationship',
							relationTo: ['tenants', 'users'],
							hasMany: true,
						},
					],
				},
				{
					label: 'Layout',
					fields: [
						{
							name: 'group',
							type: 'group',
							admin: { description: 'A named group.' },
							fields: [
								{ name: 'groupText', type: 'text' },
								{ name: 'groupSelect', type: 'select', options },
							],
						},
						{
							type: 'collapsible',
							label: 'Collapsible',
							fields: [
								{ name: 'collapsibleText', type: 'text' },
								{ name: 'collapsibleNumber', type: 'number' },
							],
						},
						{
							name: 'array',
							type: 'array',
							fields: [
								{
									type: 'row',
									fields: [
										{ name: 'label', type: 'text', admin: { width: '50%' } },
										{ name: 'value', type: 'number', admin: { width: '50%' } },
									],
								},
							],
						},
						{
							name: 'blocks',
							type: 'blocks',
							blocks: [
								{
									slug: 'quote',
									fields: [
										{ name: 'quote', type: 'textarea' },
										{ name: 'author', type: 'text' },
									],
								},
								{
									slug: 'cta',
									fields: [
										{ name: 'label', type: 'text' },
										{ name: 'style', type: 'select', options },
									],
								},
							],
						},
					],
				},
			],
		},
		{ name: 'sidebarText', type: 'text', admin: { position: 'sidebar' } },
		{ name: 'sidebarSelect', type: 'select', options, admin: { position: 'sidebar' } },
		{ name: 'sidebarCheckbox', type: 'checkbox', admin: { position: 'sidebar' } },
	],
}
