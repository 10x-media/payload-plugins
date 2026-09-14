import type { CollectionConfig } from 'payload'

import { defineFormVariants } from '../../src/index'
import { isAdmin } from './users'

/**
 * The collection the design is tested against: dozens of fields, of which an occasional
 * editor needs four. `quick` is one identity step, an optional contact step, and a component
 * step that searches for duplicates, with a custom `Outcome`. Admins get the native form and
 * may switch to `quick` or to `review`, a free-navigation variant that saves on any step.
 */
export const people: CollectionConfig = {
	slug: 'people',
	admin: {
		defaultColumns: ['lastName', 'firstName', 'email', 'employer'],
		useAsTitle: 'lastName',
	},
	custom: {
		formVariants: defineFormVariants('people', {
			defaultVariant: ({ user }) => (isAdmin(user) ? 'native' : 'quick'),
			variants: [
				{
					key: 'quick',
					label: 'Quick form',
					steps: [
						{
							key: 'identity',
							label: 'Who is this?',
							description: 'The four fields every person needs.',
							fields: ['firstName', 'lastName', 'dateOfBirth', 'gender'],
						},
						{
							key: 'contact',
							label: 'How to reach them',
							description: 'Shown only when the person is old enough to be contacted directly.',
							condition: ({ values }) => {
								const raw = values.dateOfBirth
								if (typeof raw !== 'string') {
									return true
								}
								const age = (Date.now() - new Date(raw).getTime()) / (365.25 * 24 * 3600 * 1000)
								return age >= 16
							},
							fields: [
								'email',
								{ path: 'phone', label: 'Phone number' },
								'address.city',
								'address.country',
							],
							gate: async ({ req, values }) => {
								const email = typeof values.email === 'string' ? values.email.trim() : ''
								if (!email) {
									return { result: 'continue' }
								}
								const existing = await req.payload.find({
									collection: 'people',
									depth: 0,
									limit: 1,
									req,
									where: { email: { equals: email } },
								})
								const other = existing.docs.find((doc) => doc.id !== (values.id as string))
								if (other) {
									return {
										message: `${email} already belongs to ${other.firstName} ${other.lastName}.`,
										result: 'block',
									}
								}
								return { result: 'patch', values: { email: email.toLowerCase() } }
							},
						},
						{
							key: 'duplicates',
							label: 'Check for duplicates',
							Component: './components/DuplicateCheckStep#DuplicateCheckStep',
						},
					],
					ui: { width: 'half' },
					components: { Outcome: './components/PersonOutcome#PersonOutcome' },
					afterSave: ({ operation, savedDoc }) =>
						operation === 'create'
							? {
									outcome: {
										id: String(savedDoc.id),
										message: 'The person was created. An admin can complete the remaining fields.',
										title: 'Saved',
									},
								}
							: null,
				},
				{
					key: 'review',
					label: 'Review',
					access: ({ user }) => isAdmin(user),
					navigation: 'free',
					save: 'always',
					steps: [
						{ key: 'identity', label: 'Identity', fields: ['firstName', 'lastName', 'gender'] },
						{
							key: 'contact',
							label: 'Contact',
							fields: ['email', 'phone', 'address'],
						},
						{ key: 'work', label: 'Work', fields: ['employer', 'position', 'skills'] },
					],
				},
				{ key: 'native', label: 'Full form', access: ({ user }) => isAdmin(user) },
			],
		}),
	},
	fields: [
		{
			type: 'row',
			fields: [
				{ name: 'firstName', type: 'text', required: true },
				{ name: 'lastName', type: 'text', required: true },
			],
		},
		{ name: 'dateOfBirth', type: 'date', required: true },
		{
			name: 'gender',
			type: 'select',
			options: ['female', 'male', 'other', 'unknown'],
			required: true,
		},
		{
			type: 'tabs',
			tabs: [
				{
					label: 'Contact',
					fields: [
						{ name: 'email', type: 'email', unique: true },
						{ name: 'phone', type: 'text' },
						{
							name: 'address',
							type: 'group',
							fields: [
								{ name: 'street', type: 'text' },
								{ name: 'city', type: 'text' },
								{ name: 'postalCode', type: 'text' },
								{ name: 'country', type: 'text', defaultValue: 'DE' },
							],
						},
					],
				},
				{
					label: 'Work',
					fields: [
						{ name: 'employer', type: 'relationship', relationTo: 'companies' },
						{ name: 'position', type: 'text' },
						{
							name: 'skills',
							type: 'array',
							fields: [
								{ name: 'name', type: 'text', required: true },
								{
									name: 'level',
									type: 'select',
									options: ['beginner', 'intermediate', 'expert'],
								},
							],
						},
					],
				},
				{
					name: 'profile',
					label: 'Profile',
					fields: [
						{ name: 'bio', type: 'richText' },
						{ name: 'website', type: 'text' },
						{
							name: 'newsletter',
							type: 'checkbox',
							admin: { description: 'Has opted in to the newsletter.' },
						},
					],
				},
			],
		},
		{
			type: 'collapsible',
			label: 'Internal',
			admin: { initCollapsed: true },
			fields: [
				{ name: 'notes', type: 'textarea' },
				{ name: 'internalId', type: 'text', admin: { position: 'sidebar' } },
				{
					name: 'status',
					type: 'select',
					admin: { position: 'sidebar' },
					defaultValue: 'active',
					options: ['active', 'inactive', 'archived'],
				},
			],
		},
	],
}
