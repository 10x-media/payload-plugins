import {
	APIError,
	type CollectionAfterChangeHook,
	type CollectionBeforeChangeHook,
	type CollectionConfig,
	type FieldHook,
	type Payload,
} from 'payload'

import { ADMIN_GROUP, SECRET_MASK, SECRET_REVEAL_CONTEXT, SECRET_UNUSABLE } from '../constants'
import { isReservedHeader } from '../delivery/headers'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../secrets/crypto'
import { generateSecret, InvalidSecretError, normalizeSecret } from '../secrets/format'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

/** Normalize a customer-supplied secret, surfacing a malformed one as a 400 rather than a 500. */
const normalizeOr400 = (value: unknown): string => {
	try {
		return normalizeSecret(String(value))
	} catch (err) {
		if (err instanceof InvalidSecretError) {
			throw new APIError(err.message, 400)
		}
		throw err
	}
}

/** The storable form of an incoming secret: already-encrypted values pass through untouched. */
const toStoredSecret = (payload: Payload, value: unknown): string =>
	isEncryptedSecret(value) ? value : encryptSecret(payload, normalizeOr400(value))

/**
 * Encrypt one incoming secret field in place. A null clears it (rotation retiring the previous
 * secret), and a masked value is dropped rather than persisted as the signing key.
 */
const withStoredSecret = (
	payload: Payload,
	data: Record<string, unknown>,
	field: 'secret' | 'previousSecret'
): Record<string, unknown> => {
	const value = data[field]
	if (value === undefined || value === null) {
		return data
	}
	if (value === SECRET_MASK) {
		const { [field]: _masked, ...rest } = data
		return rest
	}
	return { ...data, [field]: toStoredSecret(payload, value) }
}

/**
 * Give every create a normalized `whsec_` secret, generated or customer-supplied, encrypt it
 * before it reaches the database, and open the one-time reveal window for both paths. The
 * plaintext is stashed on the request because the create response reads back ciphertext and
 * cannot recover it otherwise. Rotation writes plaintext into both secret fields, so updates
 * encrypt whichever ones are present.
 */
const prepareSecret: CollectionBeforeChangeHook = ({ data, operation, req }) => {
	if (operation === 'create') {
		const plaintext = data.secret ? normalizeOr400(data.secret) : generateSecret()
		req.context[SECRET_REVEAL_CONTEXT.once] = true
		req.context[SECRET_REVEAL_CONTEXT.plaintext] = plaintext
		// `previousSecret` still goes through the encrypt path: field access blocks it from an
		// ordinary create, but an `overrideAccess` create would otherwise persist it in plaintext.
		return withStoredSecret(
			req.payload,
			{ ...data, secret: encryptSecret(req.payload, plaintext) },
			'previousSecret'
		)
	}
	return withStoredSecret(
		req.payload,
		withStoredSecret(req.payload, data, 'secret'),
		'previousSecret'
	)
}

/**
 * The database stores ciphertext; this hook shapes read output. It runs even under
 * `overrideAccess` (field hooks are not gated by access), so plaintext reaches a reader only
 * when a reveal flag is set: `once` returns the stashed create-time plaintext, `forSigning`
 * decrypts for internal delivery reads. Every other read, admin, REST, or GraphQL, sees the mask.
 */
const maskSecret: FieldHook = ({ value, req }) => {
	if (value == null) {
		return value
	}
	if (req.context[SECRET_REVEAL_CONTEXT.raw]) {
		return value
	}
	if (req.context[SECRET_REVEAL_CONTEXT.once]) {
		return req.context[SECRET_REVEAL_CONTEXT.plaintext] ?? SECRET_MASK
	}
	if (req.context[SECRET_REVEAL_CONTEXT.forSigning]) {
		const plaintext = decryptSecret(req.payload, String(value))
		if (!plaintext) {
			req.payload.logger.error(
				`@10x-media/webhooks: a stored signing secret could not be decrypted, so deliveries for this subscription will fail instead of being sent unsigned. Either PAYLOAD_SECRET changed after the secret was stored, or the subscription predates encryption at rest and needs encryptExistingSecrets(). Rotating the secret also recovers it.`
			)
			return SECRET_UNUSABLE
		}
		return plaintext
	}
	return SECRET_MASK
}

const clearRevealOnce: CollectionAfterChangeHook = ({ doc, req }) => {
	req.context[SECRET_REVEAL_CONTEXT.once] = false
	req.context[SECRET_REVEAL_CONTEXT.plaintext] = undefined
	return doc
}

const loggedIn = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

/** Admin-managed subscriptions collection; `events` options come from the catalog. */
export const buildSubscriptionsCollection = (args: {
	slug: string
	events: string[]
	hidden: boolean
}): CollectionConfig => ({
	slug: args.slug,
	labels: {
		singular: labelForKey(keys.subscriptionSingular),
		plural: labelForKey(keys.subscriptionPlural),
	},
	admin: {
		group: ADMIN_GROUP,
		useAsTitle: 'name',
		defaultColumns: ['name', 'url', 'enabled'],
		hidden: args.hidden,
	},
	access: { read: loggedIn, create: loggedIn, update: loggedIn, delete: loggedIn },
	hooks: { beforeChange: [prepareSecret], afterChange: [clearRevealOnce] },
	fields: [
		{ name: 'name', type: 'text', required: true, label: labelForKey(keys.fieldName) },
		{ name: 'url', type: 'text', required: true, label: labelForKey(keys.fieldUrl) },
		{
			name: 'enabled',
			type: 'checkbox',
			defaultValue: true,
			label: labelForKey(keys.fieldEnabled),
		},
		{
			name: 'events',
			type: 'select',
			hasMany: true,
			label: labelForKey(keys.fieldEvents),
			options: args.events.length
				? args.events.map((e) => ({ label: e, value: e }))
				: [{ label: '(none)', value: '__none__' }],
		},
		{
			name: 'secret',
			type: 'text',
			label: labelForKey(keys.fieldSecret),
			admin: { readOnly: true, description: labelForKey(keys.fieldSecretHelp) },
			access: { update: () => false },
			hooks: { afterRead: [maskSecret] },
		},
		{
			name: 'previousSecret',
			type: 'text',
			admin: { readOnly: true, hidden: true },
			// Rotation and the adoption utility write these under `overrideAccess`, which bypasses
			// field access. Denying create as well as update is what stops an ordinary REST or
			// GraphQL create from planting a second signing key, in plaintext, on a new
			// subscription: `admin.hidden` only hides the field in the UI.
			access: { create: () => false, update: () => false },
			hooks: { afterRead: [maskSecret] },
		},
		{
			name: 'previousSecretExpiresAt',
			type: 'date',
			label: labelForKey(keys.fieldPreviousSecretExpires),
			admin: { readOnly: true, description: labelForKey(keys.fieldPreviousSecretExpiresHelp) },
			access: { create: () => false, update: () => false },
		},
		{
			name: 'rotateSecret',
			type: 'ui',
			admin: { components: { Field: '@10x-media/webhooks/client#RotateSecretButton' } },
		},
		{
			name: 'headers',
			type: 'array',
			label: labelForKey(keys.fieldHeaders),
			fields: [
				{
					name: 'key',
					type: 'text',
					required: true,
					validate: (value: string | null | undefined) =>
						typeof value === 'string' && isReservedHeader(value)
							? `'${value}' is set by the plugin on every delivery and cannot be overridden.`
							: true,
				},
				{ name: 'value', type: 'text' },
			],
		},
		{ name: 'description', type: 'textarea', label: labelForKey(keys.fieldDescription) },
	],
})
