import type { CollectionConfig } from 'payload'

const COMPONENTS = '/components/Showcase'

/**
 * Dev stand only: fields that do not look like Payload's own, to see how the merge screen
 * draws them. A custom input on a text and a number, a custom description, groups drawn as
 * one input, an array with its own row label, one drawn by a custom component as a whole,
 * and blocks with their own row label.
 */
export const showcases: CollectionConfig = {
	slug: 'showcases',
	trash: true,
	labels: { singular: 'Custom field', plural: 'Custom fields' },
	admin: { useAsTitle: 'name', defaultColumns: ['name', 'email', 'color', 'phone'] },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{
			name: 'email',
			type: 'email',
			admin: {
				description: 'A plain string description under a native field.',
			},
		},
		{
			name: 'website',
			type: 'text',
			admin: { components: { Description: `${COMPONENTS}#WebsiteDescription` } },
		},
		{
			name: 'color',
			type: 'text',
			admin: { components: { Field: `${COMPONENTS}#ColorField` } },
		},
		{
			name: 'rating',
			type: 'number',
			admin: { components: { Field: `${COMPONENTS}#RatingField` } },
		},
		// A group drawn as one input, as `@10x-media/fields`' phone number is.
		{
			name: 'phone',
			type: 'group',
			admin: { components: { Field: `${COMPONENTS}#PhoneField` } },
			fields: [
				{ name: 'country', type: 'text' },
				{ name: 'number', type: 'text' },
			],
		},
		{
			name: 'budget',
			type: 'group',
			admin: { components: { Field: `${COMPONENTS}#MoneyField` } },
			fields: [
				{ name: 'amount', type: 'number' },
				{ name: 'currency', type: 'select', options: ['EUR', 'USD', 'UAH'] },
			],
		},
		{
			name: 'contacts',
			type: 'array',
			admin: { components: { RowLabel: `${COMPONENTS}#ContactRowLabel` } },
			fields: [
				{ name: 'person', type: 'text' },
				{ name: 'role', type: 'select', options: ['owner', 'billing', 'technical'] },
				{ name: 'city', type: 'text' },
			],
		},
		// An array whose custom component draws the rows itself, without Payload's array rows.
		{
			name: 'labels',
			type: 'array',
			admin: { components: { Field: `${COMPONENTS}#ChipsArrayField` } },
			fields: [
				{ name: 'text', type: 'text' },
				{ name: 'tone', type: 'select', options: ['neutral', 'warning', 'success'] },
			],
		},
		{
			name: 'sections',
			type: 'blocks',
			blocks: [
				{
					slug: 'heading',
					admin: { components: { Label: `${COMPONENTS}#SectionRowLabel` } },
					fields: [{ name: 'text', type: 'text' }],
				},
				{
					slug: 'callout',
					admin: { components: { Label: `${COMPONENTS}#SectionRowLabel` } },
					fields: [
						{ name: 'title', type: 'text' },
						{ name: 'body', type: 'textarea' },
					],
				},
			],
		},
	],
}
