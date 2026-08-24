import { isSealed, type KeysConfig } from '@10x-media/fields/encrypted'
import type {
	CollectionAfterChangeHook,
	CollectionBeforeChangeHook,
	CollectionBeforeValidateHook,
	CollectionConfig,
	PayloadRequest,
} from 'payload'

import { ADMIN_GROUP, GENERATED_SECRET_KEY } from '../constants'
import { isReservedHeader, isValidHeaderName } from '../delivery/headers'
import { generateSecret, normalizeSecret } from '../secrets/format'
import { buildSecretFields } from '../secrets/secretFields'
import { keys } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'

/**
 * Carries a create's generated secret from the hook that made it to the hook that returns it.
 * Write-only storage strips the field from every read, the create response included, so the
 * plaintext cannot ride back on the field itself.
 */
const GENERATED_SECRET_CONTEXT = 'webhooksGeneratedSecret'

/**
 * Give a create with no secret a generated one, the way Stripe and Svix do: a caller who supplies
 * a secret already holds it, but one who does not gets a usable subscription rather than an
 * unsigned one. The value is stashed for the create response, since it is the only moment it can
 * ever be read back.
 *
 * The field's own admin Generate action covers the form, which runs client-side by design; this
 * covers every API create. Only a genuinely absent secret is generated: an explicitly empty
 * string is left alone so the field validator can reject it, because a caller who meant to supply
 * a secret should hear about it rather than be handed a generated one they never learn about.
 *
 * A sealed value arriving on a create is never customer input, since a caller supplies plaintext.
 * It is what Payload's duplicate action resubmits, from the row it copied, and two subscriptions
 * sharing one signing key is exactly what must not happen: the copy is given its own secret, and
 * none of the original's rotation state.
 */
const generateOnCreate: CollectionBeforeValidateHook = ({ data, operation, req }) => {
	if (operation !== 'create' || !data) {
		return data
	}
	const next = { ...data }
	if (isSealed(next.previousSecret)) {
		next.previousSecret = null
		next.previousSecretExpiresAt = null
	}
	if (isSealed(next.secret)) {
		next.secret = undefined
	}
	if (next.secret !== undefined && next.secret !== null) {
		return next
	}
	const secret = generateSecret()
	req.context[GENERATED_SECRET_CONTEXT] = secret
	next.secret = secret
	return next
}

const SECRET_FIELDS = ['secret', 'previousSecret'] as const

/**
 * Normalize whatever plaintext a write carries into canonical `whsec_<base64>` form before the
 * field seals it, so a stored secret is always in exactly one spelling. Two spellings of the same
 * key would compare unequal in the rotation swap and would each have to be tried on read.
 *
 * A value that will not normalize is left as it is, for the field's own validator to reject with
 * the reason: rewriting it here would turn a 400 naming the problem into a stored secret the
 * caller never agreed to.
 */
const normalizeSuppliedSecrets: CollectionBeforeChangeHook = ({ data }) => {
	const next = { ...data }
	for (const field of SECRET_FIELDS) {
		const value = next[field]
		if (typeof value !== 'string' || value === '' || isSealed(value)) {
			continue
		}
		try {
			next[field] = normalizeSecret(value)
		} catch {
			// left for the field validator
		}
	}
	return next
}

/**
 * Return a generated secret once, under its own key.
 *
 * `secret` itself is stripped from every read, so a create response cannot carry it. A separate
 * key is the better contract anyway: one field that behaves differently exactly once is the kind
 * of thing a caller writes code against and then loses when the behaviour is tightened.
 */
const revealGeneratedSecret: CollectionAfterChangeHook = ({ doc, operation, req }) => {
	const generated = req.context[GENERATED_SECRET_CONTEXT]
	req.context[GENERATED_SECRET_CONTEXT] = undefined
	if (operation !== 'create' || typeof generated !== 'string') {
		return doc
	}
	return { ...doc, [GENERATED_SECRET_KEY]: generated }
}

/**
 * Retired key material whose grace window has closed is inert (the resolver ignores a lapsed
 * window), but there is no reason to keep it. Clearing it on the next privileged write of the row
 * is free, needs no scheduler, and cannot race a delivery the way a write from the delivery path
 * could.
 *
 * Payload merges the stored document into `data`, so the retired secret is present on every
 * update as its own ciphertext; presence alone therefore says nothing. Only an unsealed value or
 * an explicit null is this write actually setting the slot, which is a rotation, and a rotation
 * owns both fields.
 */
const clearLapsedRotation: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
	const rotating =
		data.previousSecret === null ||
		(typeof data.previousSecret === 'string' && !isSealed(data.previousSecret))
	if (rotating || !originalDoc) {
		return data
	}
	const expiresAt = (originalDoc as Record<string, unknown>).previousSecretExpiresAt
	if (expiresAt == null) {
		return data
	}
	const expires = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt))
	if (!Number.isFinite(expires) || Date.now() < expires) {
		return data
	}
	return { ...data, previousSecret: null, previousSecretExpiresAt: null }
}

const loggedIn = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

/** Admin-managed subscriptions collection; `events` options come from the catalog. */
export const buildSubscriptionsCollection = (args: {
	slug: string
	events: string[]
	hidden: boolean
	secretKeys?: KeysConfig
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
		beforeValidate: [generateOnCreate],
		beforeChange: [normalizeSuppliedSecrets, clearLapsedRotation],
		afterChange: [revealGeneratedSecret],
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
		...buildSecretFields({ keys: args.secretKeys }),
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
						if (isReservedHeader(value)) {
							return asTranslate(req.t)(keys.headerReserved, { name: value })
						}
						// A name with a space or a colon saves fine and then makes `fetch` throw at
						// delivery time, so the operator would find out from a dead delivery row rather
						// than from the form.
						return isValidHeaderName(value)
							? true
							: asTranslate(req.t)(keys.headerInvalid, { name: value })
					},
				},
				{ name: 'value', type: 'text' },
			],
		},
		{ name: 'description', type: 'textarea', label: labelForKey(keys.fieldDescription) },
	],
})
