import type { CollectionConfig } from 'payload'
import { encryptedField } from '../../src/exports/encrypted'

/**
 * Showcase: one encrypted field per supported type, a queryable unique email,
 * masked vs protection 'none' side by side, point + richText examples.
 */
export const encrypted: CollectionConfig = {
	slug: 'encrypted',
	admin: { useAsTitle: 'label' },
	fields: [
		{ name: 'label', type: 'text', required: true },
		...encryptedField({
			admin: { description: 'Masked by default: dots + reveal toggle.' },
			name: 'fullName',
			required: true,
			type: 'text',
		}),
		...encryptedField(
			{
				admin: { description: "protection: 'none': native input, still encrypted at rest." },
				name: 'notes',
				type: 'textarea',
			},
			{ protection: 'none' }
		),
		...encryptedField(
			{
				admin: { description: 'Queryable + unique via blind index.' },
				name: 'contactEmail',
				type: 'email',
				unique: true,
			},
			{ queryable: true }
		),
		...encryptedField({ name: 'salary', type: 'number' }),
		...encryptedField({ name: 'isVip', type: 'checkbox' }),
		...encryptedField({ name: 'birthday', type: 'date' }),
		...encryptedField({
			name: 'tier',
			options: ['free', 'pro', 'enterprise'],
			type: 'select',
		}),
		...encryptedField({
			hasMany: true,
			name: 'channels',
			options: ['email', 'sms', 'push'],
			type: 'select',
		}),
		...encryptedField({ name: 'referral', options: ['friend', 'ad', 'search'], type: 'radio' }),
		...encryptedField({
			admin: { language: 'typescript' },
			name: 'apiSnippet',
			type: 'code',
		}),
		...encryptedField({ name: 'metadata', type: 'json' }),
		...encryptedField({
			admin: { description: 'Encrypted point: geo queries are unavailable by design.' },
			name: 'lastKnownLocation',
			type: 'point',
		}),
		...encryptedField({
			admin: { description: 'Encrypted rich text: masked JSON view, edit via API.' },
			name: 'privateNotes',
			type: 'richText',
		}),
	],
}
