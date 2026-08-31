import type { CollectionConfig } from 'payload'
import { encryptedField } from '../../src/exports/encrypted'

/**
 * Showcase: one encrypted field per supported type, a queryable unique email, a
 * configurable dot-count example, masked vs protection 'none' side by side, and
 * point + richText (masked full editor and protection 'none' full editor).
 * Each description names the underlying field type so the example is self-labeling.
 */
export const encrypted: CollectionConfig = {
	slug: 'encrypted',
	admin: { useAsTitle: 'label' },
	fields: [
		{ name: 'label', type: 'text', required: true },
		...encryptedField({
			admin: {
				description: 'text field. Masked by default: dots + eyeball toggle inside the input.',
			},
			name: 'fullName',
			required: true,
			type: 'text',
		}),
		...encryptedField(
			{
				admin: { description: 'text field with maskDots: 32, e.g. a known 32-character API key.' },
				name: 'apiKey',
				type: 'text',
			},
			{ maskDots: 32 }
		),
		...encryptedField(
			{
				admin: {
					description: "textarea field. protection: 'none': native input, still encrypted at rest.",
				},
				name: 'notes',
				type: 'textarea',
			},
			{ protection: 'none' }
		),
		...encryptedField(
			{
				admin: {
					description:
						"text field. protection: 'writeOnly': never returned by any API; replace or clear, never reveal.",
				},
				name: 'webhookSecret',
				type: 'text',
			},
			{ protection: 'writeOnly' }
		),
		...encryptedField(
			{
				admin: {
					description: 'email field. Queryable + unique via the blind index (equals/in filtering).',
				},
				name: 'contactEmail',
				type: 'email',
				unique: true,
			},
			{ queryable: true }
		),
		...encryptedField({
			admin: { description: 'number field.' },
			name: 'salary',
			type: 'number',
		}),
		...encryptedField({
			admin: { description: 'checkbox field. Masked as an indeterminate dash.' },
			name: 'isVip',
			type: 'checkbox',
		}),
		...encryptedField({ admin: { description: 'date field.' }, name: 'birthday', type: 'date' }),
		...encryptedField({
			admin: { description: 'select field.' },
			name: 'tier',
			options: ['free', 'pro', 'enterprise'],
			type: 'select',
		}),
		...encryptedField({
			admin: {
				description: 'select field (hasMany). Masked as one dot run so the count never leaks.',
			},
			hasMany: true,
			name: 'channels',
			options: ['email', 'sms', 'push'],
			type: 'select',
		}),
		...encryptedField({
			admin: { description: 'radio field.' },
			name: 'referral',
			options: ['friend', 'ad', 'search'],
			type: 'radio',
		}),
		...encryptedField({
			admin: {
				description: 'code field. Masked as dot lines, no editor mounted.',
				language: 'typescript',
			},
			name: 'apiSnippet',
			type: 'code',
		}),
		...encryptedField({
			admin: { description: 'json field. The only type that shows JSON, and only when revealed.' },
			name: 'metadata',
			type: 'json',
		}),
		...encryptedField({
			admin: { description: 'point field. Geo queries are unavailable by design.' },
			name: 'lastKnownLocation',
			type: 'point',
		}),
		...encryptedField({
			admin: {
				description: 'richText field. Masked, the full editor mounts on reveal (blocks included).',
			},
			name: 'privateNotes',
			type: 'richText',
		}),
		...encryptedField(
			{
				admin: {
					description:
						"richText field. protection 'none': the full editor renders directly, encrypted at rest.",
				},
				name: 'draftBody',
				type: 'richText',
			},
			{ protection: 'none' }
		),
	],
}
