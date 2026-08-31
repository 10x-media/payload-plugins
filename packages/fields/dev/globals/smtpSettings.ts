import type { GlobalConfig } from 'payload'
import { encryptedField } from '../../src/exports/encrypted'

/**
 * Showcase: the write-only credentials pattern on a settings global. The
 * password never appears in any read result; server code reads it deliberately
 * via readEncryptedField / decryptFieldValue.
 */
export const smtpSettings: GlobalConfig = {
	slug: 'smtp-settings',
	fields: [
		{ name: 'host', type: 'text' },
		{ name: 'user', type: 'text' },
		...encryptedField(
			{
				admin: {
					description:
						"text field. protection: 'writeOnly' on a global: set once, used server-side, never readable.",
				},
				name: 'password',
				type: 'text',
			},
			{ protection: 'writeOnly' }
		),
	],
}
