import { encryptedField } from '@10x-media/fields/encrypted'
import type { KeysConfig } from '@10x-media/fields/types'
import type { Field } from 'payload'

import {
	GENERATED_SECRET_CHARS,
	SECRET_AAD_SCOPE,
	SECRET_HINT_SUFFIX,
	SECRET_PREFIX,
} from '../constants'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { InvalidSecretError, normalizeSecret } from './format'

/** The two slots a subscription stores key material in. */
export type SecretPath = 'previousSecret' | 'secret'

/**
 * Names of the siblings `encryptedField` adds beside a write-only value. Both mirror its
 * `${name}_set` / `${name}_hint` convention rather than being read off the marker, because the
 * resolver needs them before it has a config in hand; `secretFields.test.ts` pins them against
 * what the factory actually emits.
 */
export const secretSetName = (path: SecretPath): string => `${path}_set`
export const secretHintName = (path: SecretPath): string => `${path}_hint`

/**
 * Validate the plaintext of a supplied secret. `encryptedField` runs this against the value
 * before sealing it, so the wire-format rules stay enforced on exactly the bytes that become the
 * HMAC key.
 */
export const validateWhsec = (value: unknown): string | true => {
	if (value == null || value === '') {
		return true
	}
	try {
		normalizeSecret(String(value))
		return true
	} catch (err) {
		return err instanceof InvalidSecretError ? err.reason : String(err)
	}
}

/**
 * Both stored secret slots, sealed by `@10x-media/fields`.
 *
 * `writeOnly` strips the ciphertext from every read result, so the plaintext never leaves the
 * server through the admin, REST, or GraphQL; the delivery path reads it deliberately through
 * the raw window instead. `aadScope` pins the ciphertext binding that would otherwise be the
 * collection slug: that slug is a plugin option, so a consumer renaming the collection would make
 * every stored secret fail authentication with nothing able to recover it.
 *
 * `update` access is denied on both. Changing the active secret is what rotation is for, and a
 * rotation is a two-field write with a grace window rather than a field edit; a plain update
 * would strand every receiver still holding the old secret. `previousSecret` also denies create,
 * because `admin.hidden` alone would not stop a REST or GraphQL create planting a second signing
 * key on a new subscription.
 */
export const buildSecretFields = (options: { keys?: KeysConfig }): Field[] => [
	...encryptedField(
		{
			name: 'secret',
			type: 'text',
			label: labelForKey(keys.fieldSecret),
			admin: {
				description: labelForKey(keys.fieldSecretHelp),
				/**
				 * Create only. The write-only editor renders Replace and Generate actions and does not
				 * consult Payload's `readOnly`, so on an existing document those would be live controls
				 * over a field whose `update` access denies the write: an operator could type a new
				 * secret, save, see no error, and still be signing with the old one. Rotation is the
				 * only way to change a stored secret, and `RotateSecretButton` is its one control.
				 */
				condition: (_data, _siblingData, { operation }) => operation === 'create',
			},
			access: { update: () => false },
			validate: validateWhsec,
		},
		{
			aadScope: SECRET_AAD_SCOPE,
			// Clearing would leave a subscription that cannot sign and cannot be recovered; the
			// affordance is rotation, which always leaves a usable secret behind.
			clearable: false,
			generate: { length: GENERATED_SECRET_CHARS, prefix: SECRET_PREFIX },
			// Every character of a signing secret is key material rather than an identifier, so the
			// hint exposes the least that still tells two keys apart.
			hint: { suffix: SECRET_HINT_SUFFIX },
			keys: options.keys,
			protection: 'writeOnly',
		}
	),
	...encryptedField(
		{
			// No validator, unlike the active secret. This slot is never operator input: rotation
			// writes a value it just recovered, and the adoption utility writes whatever the row
			// already held. Validating it would only mean that a legacy row whose retired secret is
			// unusable could not have its *active* secret sealed either, because Payload merges the
			// stored document into every write and would re-validate the sibling.
			name: 'previousSecret',
			type: 'text',
			admin: { hidden: true },
			access: { create: () => false, update: () => false },
		},
		{
			aadScope: SECRET_AAD_SCOPE,
			clearable: false,
			keys: options.keys,
			protection: 'writeOnly',
		}
	),
]
