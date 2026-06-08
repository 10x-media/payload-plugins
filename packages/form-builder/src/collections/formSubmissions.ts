import type { CollectionConfig } from 'payload'
import type { FieldTypeRegistry } from '../fields/registry'
import { FORMS_SLUG } from './forms'

export const FORM_SUBMISSIONS_SLUG = 'form-submissions'

export const buildSubmissionsCollection = (_registry: FieldTypeRegistry): CollectionConfig => ({
	slug: FORM_SUBMISSIONS_SLUG,
	labels: { singular: 'Submission', plural: 'Submissions' },
	admin: { group: 'Forms' },
	access: {
		create: () => true,
		read: ({ req }) => Boolean(req.user),
		update: () => false,
	},
	fields: [
		{ name: 'form', type: 'relationship', relationTo: FORMS_SLUG, required: true },
		{
			name: 'status',
			type: 'select',
			defaultValue: 'complete',
			options: [
				{ label: 'Complete', value: 'complete' },
				{ label: 'Partial', value: 'partial' },
			],
		},
		{ name: 'locale', type: 'text' },
		{ name: 'values', type: 'json' },
		{ name: 'descriptors', type: 'json' },
		{ name: 'consent', type: 'json' },
		{ name: 'meta', type: 'json' },
	],
})
