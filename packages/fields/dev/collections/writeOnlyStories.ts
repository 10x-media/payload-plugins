import type { CollectionConfig } from 'payload'
import { encryptedField } from '../../src/exports/encrypted'

/**
 * Showcase: one field per write-only user story, each description stating the
 * expected UX so the admin doubles as the acceptance spec. Two seeded docs
 * cover the set and unset states; typing, clearing, undoing, and generating
 * are exercised interactively.
 */
export const writeOnlyStories: CollectionConfig = {
	slug: 'write-only-stories',
	admin: {
		useAsTitle: 'label',
		description:
			'One field per write-only user story. The input is always editable: a stored value is only a placeholder (hint or dots), typing stages a replacement, emptying the input keeps the stored value, and every action lives inside the input row.',
	},
	fields: [
		{ name: 'label', type: 'text', required: true },
		...encryptedField(
			{
				admin: {
					description:
						'STORY 1, pasted service password (SMTP/IMAP/FTP). Nobody ever needs it back. Set state shows anonymous dots as placeholder; type to stage a replacement (visible until save), empty the input to keep the stored value, × clears (undo arrow follows), and an untouched save always preserves. No hint, no generate: a password must never be sliced or invented.',
				},
				name: 'smtpPassword',
				type: 'text',
			},
			{ protection: 'writeOnly' }
		),
		...encryptedField(
			{
				admin: {
					description:
						'STORY 2, pasted third-party API key that must stay identifiable (Stripe/SendGrid). hint: { prefix: 4, suffix: 4 } stores an identification slice beside the ciphertext at seal time; the API returns it as stripeKey_hint (sk_d····9d3f), and the set state and list cell render the gap as the maskDots bullet run (sk_d••••••••9d3f), matching every other concealed span. The full value stays unreadable forever; values shorter than prefix + suffix + 8 store no hint at all.',
				},
				name: 'stripeKey',
				type: 'text',
			},
			{ hint: { prefix: 4, suffix: 4 }, protection: 'writeOnly' }
		),
		...encryptedField(
			{
				admin: {
					description:
						'STORY 3, generated webhook signing secret, reveal-once. The circular-arrows action generates whsec_ + 32 crypto-random chars client-side, selected and copyable in the input exactly until save, never visible again after. A lost secret means regenerate and reconfigure the other side. × while a generated value is staged discards it; × on the stored value clears it.',
				},
				name: 'webhookSecret',
				type: 'text',
			},
			{ generate: { length: 32, prefix: 'whsec_' }, protection: 'writeOnly' }
		),
		...encryptedField(
			{
				admin: {
					description:
						'STORY 4, per-tenant API key with support conversations. generate + hint together: generation creates tnnt_ + 32 chars shown once until save; afterwards the field and the list cell show tnnt····last4 so support can identify the key ("the key ending …") without ever reading it, and regenerating rotates it without exposing the old one.',
				},
				name: 'tenantApiKey',
				type: 'text',
			},
			{
				generate: { length: 32, prefix: 'tnnt_' },
				hint: { prefix: 4, suffix: 4 },
				protection: 'writeOnly',
			}
		),
		...encryptedField(
			{
				admin: {
					description:
						'STORY 5, recovery-readable credential, the deliberate BOUNDARY of writeOnly. An operator occasionally must read this back, so it uses protection: "masked" on purpose: dots with a working eye that reveals the full value. If you want "writeOnly but I can peek", you want masked, not a new mode.',
				},
				name: 'dbPassword',
				type: 'text',
			},
			{ protection: 'masked' }
		),
		...encryptedField(
			{
				admin: {
					description:
						'STORY 6, rotation by a low-trust editor, on a REQUIRED field. required forces clearable off, so there is no × on the stored value (clearing could never save) and the only actions are replace-by-typing and generate. The suffix hint (····last4) lets the editor confirm WHICH credential they rotated without any reveal. An untouched save preserves; emptying a half-typed replacement reverts to the stored value.',
				},
				name: 'rotationSecret',
				required: true,
				type: 'text',
			},
			{ generate: true, hint: { suffix: 4 }, protection: 'writeOnly' }
		),
	],
}
