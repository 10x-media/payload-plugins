import {
	APIError,
	type CollectionAfterChangeHook,
	type CollectionAfterErrorHook,
	type CollectionBeforeChangeHook,
	type CollectionConfig,
	type FieldHook,
	type Payload,
	type PayloadRequest,
} from 'payload'

import { ADMIN_GROUP, SECRET_MASK, SECRET_REVEAL_CONTEXT, SECRET_UNUSABLE } from '../constants'
import { isReservedHeader } from '../delivery/headers'
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../secrets/crypto'
import { generateSecret, InvalidSecretError, normalizeSecret } from '../secrets/format'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'

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
 * A read-shaped stand-in rather than key material. Both are what a read hands back in place of a
 * secret, so a caller that round-trips a document it read is writing one of these, not a secret,
 * and it must never be persisted as the signing key.
 */
const isPlaceholderSecret = (value: unknown): boolean =>
	value === SECRET_MASK || value === SECRET_UNUSABLE

/**
 * Encrypt one incoming secret field in place. A null clears it (rotation retiring the previous
 * secret), and a placeholder is dropped rather than persisted as the signing key.
 */
const withStoredSecret = (
	payload: Payload,
	data: Record<string, unknown>,
	field: 'previousSecret' | 'secret'
): Record<string, unknown> => {
	const value = data[field]
	if (value === undefined || value === null) {
		return data
	}
	if (isPlaceholderSecret(value)) {
		const { [field]: _placeholder, ...rest } = data
		return rest
	}
	return { ...data, [field]: toStoredSecret(payload, value) }
}

/**
 * Retired key material whose grace window has closed is inert (the resolver ignores a lapsed
 * window), but there is no reason to keep it. Clearing it on the next write of the row is free,
 * needs no scheduler, and cannot race a delivery the way a write from the delivery path could.
 */
const withLapsedRotationCleared = (
	data: Record<string, unknown>,
	originalDoc: Record<string, unknown> | undefined,
	now: number
): Record<string, unknown> => {
	if (!originalDoc || data.previousSecret !== undefined) {
		return data
	}
	const expiresAt = originalDoc.previousSecretExpiresAt
	if (originalDoc.previousSecret == null || expiresAt == null) {
		return data
	}
	const expires = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt))
	if (!Number.isFinite(expires) || now < expires) {
		return data
	}
	return { ...data, previousSecret: null, previousSecretExpiresAt: null }
}

/**
 * Give every create a normalized `whsec_` secret, generated or customer-supplied, encrypt it
 * before it reaches the database, and open the one-time reveal window for both paths. The
 * plaintext is stashed on the request because the create response reads back ciphertext and
 * cannot recover it otherwise. Rotation writes plaintext into both secret fields, so updates
 * encrypt whichever ones are present.
 */
const prepareSecret: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
	if (operation === 'create') {
		// A placeholder here is a document that was read and resubmitted, which is exactly what
		// Payload's duplicate action does: it carries the mask, not key material. Treating it as
		// absent gives the copy its own fresh secret, which is what a duplicate should have anyway.
		// Only a genuinely absent secret is generated. An empty string is a caller that meant to
		// supply one, so it is rejected rather than quietly swapped for a generated secret the
		// caller never learns about. Payload's admin omits the field entirely, so this is API
		// callers only.
		const supplied = isPlaceholderSecret(data.secret) ? undefined : data.secret
		const plaintext =
			supplied === undefined || supplied === null ? generateSecret() : normalizeOr400(supplied)
		const ciphertext = encryptSecret(req.payload, plaintext)
		req.context[SECRET_REVEAL_CONTEXT.once] = true
		// Bound to the exact ciphertext this create produced. Every encryption uses a fresh IV, so
		// the stash can only ever match the document it came from: a stash left behind by a create
		// that threw after this hook is inert rather than a reveal channel for another document.
		req.context[SECRET_REVEAL_CONTEXT.plaintext] = { ciphertext, plaintext }
		// `previousSecret` still goes through the encrypt path: field access blocks it from an
		// ordinary create, but an `overrideAccess` create would otherwise persist it in plaintext.
		return withStoredSecret(req.payload, { ...data, secret: ciphertext }, 'previousSecret')
	}
	return withLapsedRotationCleared(
		withStoredSecret(req.payload, withStoredSecret(req.payload, data, 'secret'), 'previousSecret'),
		originalDoc as Record<string, unknown> | undefined,
		Date.now()
	)
}

/** The create-time reveal stash: plaintext bound to the ciphertext it was stored as. */
type RevealStash = { ciphertext: string; plaintext: string }

const clearReveal = (req: PayloadRequest): void => {
	req.context[SECRET_REVEAL_CONTEXT.once] = false
	req.context[SECRET_REVEAL_CONTEXT.plaintext] = undefined
}

/**
 * Hand back the create-time plaintext for one value, and close the window in the same step.
 *
 * The stash is bound to the exact ciphertext the create produced, so it can only ever match the
 * document it came from. Consuming it on the first match makes the reveal literally once, enforced
 * at the read rather than by a later hook: Payload only runs collection `afterError` from its HTTP
 * layer, so a Local API create that throws after `beforeChange` never reaches any cleanup hook.
 */
const takeStashedPlaintext = (req: PayloadRequest, value: string): string | null => {
	const stash = req.context[SECRET_REVEAL_CONTEXT.plaintext] as RevealStash | undefined
	if (stash?.ciphertext !== value) {
		return null
	}
	clearReveal(req)
	return stash.plaintext
}

/**
 * The database stores ciphertext; this hook shapes read output. It runs even under
 * `overrideAccess` (field hooks are not gated by access), so plaintext reaches a reader only
 * when a reveal flag is set: `once` returns the create-time plaintext for the one field and
 * document it belongs to, `forSigning` decrypts for internal delivery reads. Every other read,
 * admin, REST, or GraphQL, sees the mask.
 *
 * `reveals` is false for `previousSecret`: only a newly created secret has a create reveal, and
 * echoing the stash there would return the new secret a second time under the wrong field.
 *
 * `slot` only shapes the failure message. Which secret failed to decrypt decides what happens to
 * the delivery, and saying "deliveries will fail" for a retired secret that merely loses its
 * rotation overlap would send an operator hunting the wrong problem.
 */
const maskSecret =
	(options: { reveals: boolean; slot: 'active' | 'retired' }): FieldHook =>
	({ collection, originalDoc, req, value }) => {
		if (value == null) {
			return value
		}
		if (req.context[SECRET_REVEAL_CONTEXT.raw]) {
			return value
		}
		if (options.reveals && req.context[SECRET_REVEAL_CONTEXT.once]) {
			return takeStashedPlaintext(req, String(value)) ?? SECRET_MASK
		}
		if (req.context[SECRET_REVEAL_CONTEXT.forSigning]) {
			const plaintext = decryptSecret(req.payload, String(value))
			if (!plaintext) {
				// Named, because an install with many subscriptions otherwise gets an error per
				// delivery with nothing in it to say which row needs migrating or rotating.
				const subject = `${collection?.slug ?? 'subscription'} ${String(originalDoc?.id ?? 'unknown')}`
				req.payload.logger.error(
					options.slot === 'active'
						? `@10x-media/webhooks: the stored signing secret for ${subject} could not be decrypted, so deliveries for this subscription will fail instead of being sent unsigned. Either PAYLOAD_SECRET changed after the secret was stored, or the subscription predates encryption at rest and needs encryptExistingSecrets(). Rotating the secret also recovers it.`
						: `@10x-media/webhooks: the retired signing secret for ${subject}, still inside its rotation grace window, could not be decrypted, so it has been dropped. Deliveries continue, signed with the current secret; receivers that have not moved off the retired secret lose their overlap early.`
				)
				return SECRET_UNUSABLE
			}
			return plaintext
		}
		return SECRET_MASK
	}

/**
 * Belt to the reveal's suspenders. A successful create closes its own window when the response
 * read consumes the stash, so this only matters for a write whose response never reads the secret
 * back, and for a create that threw before it: Payload runs collection `afterError` from its HTTP
 * layer only, so a failed Local API create reaches neither hook. The ciphertext binding is what
 * makes a leftover stash harmless in that case; these two just keep a long-lived request tidy.
 */
const clearRevealOnce: CollectionAfterChangeHook = ({ doc, req }) => {
	clearReveal(req)
	return doc
}

const clearRevealOnError: CollectionAfterErrorHook = ({ req }) => {
	clearReveal(req)
	return undefined
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
	hooks: {
		beforeChange: [prepareSecret],
		afterChange: [clearRevealOnce],
		afterError: [clearRevealOnError],
	},
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
			hooks: { afterRead: [maskSecret({ reveals: true, slot: 'active' })] },
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
			hooks: { afterRead: [maskSecret({ reveals: false, slot: 'retired' })] },
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
					/**
					 * A custom `validate` replaces Payload's built-in field validation rather than
					 * running alongside it, so `required: true` alone would no longer be enforced:
					 * the empty-value check below is what keeps it.
					 */
					validate: (
						value: string | null | undefined,
						{ req }: { req: PayloadRequest }
					): string | true => {
						if (typeof value !== 'string' || value.trim() === '') {
							// Payload's own key, so this reads the same as every other required field.
							return req.t('validation:required')
						}
						return isReservedHeader(value)
							? asTranslate(req.t)(keys.headerReserved, { name: value })
							: true
					},
				},
				{ name: 'value', type: 'text' },
			],
		},
		{ name: 'description', type: 'textarea', label: labelForKey(keys.fieldDescription) },
	],
})
