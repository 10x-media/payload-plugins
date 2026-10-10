import {
	type DecryptFailurePolicy,
	encryptedField,
	isSealed,
	type KeysConfig,
} from '@10x-media/fields/encrypted'
import {
	type CollectionAfterChangeHook,
	type CollectionBeforeChangeHook,
	type CollectionBeforeValidateHook,
	type CollectionConfig,
	type FieldHook,
	type PayloadRequest,
	ValidationError,
} from 'payload'

import { ADMIN_GROUP, GENERATED_SECRET_KEY, SECRET_AAD_SCOPE } from '../constants'
import {
	hostOf,
	resolvesToBlocked,
	type UrlPolicy,
	type UrlRefusal,
	urlRefusal,
} from '../delivery/destination'
import { isReservedHeader, isValidHeaderName } from '../delivery/headers'
import { generateSecret, normalizeSecret } from '../secrets/format'
import { buildSecretFields } from '../secrets/secretFields'
import { keys, type TranslationKey } from '../translations/keys'
import { asTranslate, labelForKey } from '../translations/server'
import { adminUser } from './access'

/**
 * Carries a create's generated secret from the hook that made it to the hook that returns it.
 * Write-only storage strips the field from every read, the create response included, so the
 * plaintext cannot ride back on the field itself.
 */
const GENERATED_SECRET_CONTEXT = 'webhooksGeneratedSecret'

/** Phrased like the wire-format reasons in `format.ts`, since it is the same class of mistake. */
const EMPTY_SECRET_ERROR =
	'the secret is empty; omit the field to have one generated, or supply a whsec_ value'

/**
 * Give a create with no secret a generated one, the way Stripe and Svix do: a caller who supplies
 * a secret already holds it, but one who does not gets a usable subscription rather than an
 * unsigned one. The value is stashed for the create response, since it is the only moment it can
 * ever be read back.
 *
 * The field's own admin Generate action covers the form, which runs client-side by design; this
 * covers every API create. Only a genuinely absent secret is generated: an explicitly empty string
 * is refused, because a caller who meant to supply a secret should hear about it rather than be
 * handed a generated one they never learn about.
 *
 * That refusal has to happen here rather than in the field validator. `encryptedField` seals before
 * it validates, and its seal hook reads a write-only empty string as a clear, so by the time
 * `validateWhsec` runs the value is null and indistinguishable from a subscription that is meant to
 * go out unsigned. Left alone, `secret: ''` returned 201 with no secret stored and every delivery
 * unsigned, which is the one downgrade this plugin refuses everywhere else.
 *
 * A sealed value arriving on a create is never customer input, since a caller supplies plaintext.
 * It is what Payload's duplicate action resubmits, from the row it copied, and two subscriptions
 * sharing one signing key is exactly what must not happen: the copy is given its own secret, and
 * none of the original's rotation state.
 *
 * The stash is cleared first rather than only after a successful create. A create that throws
 * between here and `revealGeneratedSecret` leaves its secret on the request, and a later create on
 * the same request would otherwise be handed that dead value as its `generatedSecret`.
 */
const generateOnCreate: CollectionBeforeValidateHook = ({ collection, data, operation, req }) => {
	if (operation !== 'create' || !data) {
		return data
	}
	req.context[GENERATED_SECRET_CONTEXT] = undefined
	const next = { ...data }
	if (next.secret === '') {
		throw new ValidationError(
			{
				collection: collection.slug,
				errors: [{ path: 'secret', message: EMPTY_SECRET_ERROR }],
			},
			req.t
		)
	}
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
 * window), but there is no reason to keep it. Clearing it on the next write of the row is free,
 * needs no scheduler, and cannot race a delivery the way a write from the delivery path could.
 *
 * Any write qualifies, an ordinary admin save included. Both fields deny `update`, but field access
 * is settled while the incoming data is validated, before collection `beforeChange` hooks run, so
 * what this hook sets is not subject to it.
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

/**
 * An endpoint has to be an absolute `http:` or `https:` URL. Anything else saves fine and then
 * makes `fetch` throw at delivery time, so the operator would find out from a dead delivery row
 * rather than from the form. Embedded credentials are the same case: `fetch` refuses a URL that
 * carries them, and a receiver's token belongs in a custom header. The scheme and the host are
 * judged by the install's URL policy: https and a public address unless `delivery.allowHttp` or
 * `delivery.allowPrivateAddresses` say otherwise.
 *
 * A URL the write is not changing is not judged at all. Payload validates the whole document on
 * every update, the stored fields included, so a rule added after a row was saved (this one, or a
 * host allowlist configured later) would otherwise fail every write to that row: rotating its
 * secret, adopting it, even switching it off. The delivery path enforces the same rules when the
 * row fires, so nothing is let through by leaving it alone here.
 */
const REFUSAL_KEY: Record<UrlRefusal, TranslationKey> = {
	invalid: keys.urlInvalid,
	host: keys.urlHostNotAllowed,
	insecure: keys.urlNotHttps,
	private: keys.urlPrivateAddress,
}

const makeValidateUrl =
	(policy: UrlPolicy) =>
	async (
		value: string | null | undefined,
		{ previousValue, req }: { previousValue?: unknown; req: PayloadRequest }
	): Promise<string | true> => {
		if (typeof value !== 'string' || value.trim() === '') {
			return req.t('validation:required')
		}
		if (value === previousValue) {
			return true
		}
		const refusal = urlRefusal(value, policy, 'collection')
		if (refusal) {
			return asTranslate(req.t)(REFUSAL_KEY[refusal])
		}
		// Told now rather than through a dead delivery row. The socket enforces the same rule on
		// every send, so a name that changes its answer later gains nothing by passing here.
		if (!policy.allowPrivateAddresses && (await resolvesToBlocked(hostOf(value)))) {
			return asTranslate(req.t)(keys.urlPrivateAddress)
		}
		return true
	}

/**
 * A line break or a NUL in a header value makes `fetch` throw at delivery time, the same way a
 * malformed name does. The admin's text input cannot produce one, but REST and GraphQL can.
 */
const validateHeaderValue = (
	value: string | null | undefined,
	{ req }: { req: PayloadRequest }
): string | true =>
	typeof value === 'string' && /[\r\n\0]/.test(value)
		? asTranslate(req.t)(keys.headerValueInvalid)
		: true

const trimHeaderName: FieldHook = ({ value }) => (typeof value === 'string' ? value.trim() : value)

/**
 * Read policy for an encrypted header value that does not open.
 *
 * A sealed value no configured key opens reads as null. The default throws, so one such header
 * would make the whole subscription unreadable, in the admin and to the resolver alike; null costs
 * that header only, and the resolver refuses the delivery.
 *
 * A value that is not sealed at all was stored before header values were encrypted, and comes back
 * as it is. The field reports it as a decrypt failure too, and nulling it would show the admin an
 * empty value that the next save then writes back, silently dropping a receiver's credential.
 * Passed through, the next save seals it instead.
 */
const headerDecryptFailure: DecryptFailurePolicy = ({ value }) => (isSealed(value) ? null : value)

/** Admin-managed subscriptions collection; `events` options come from the catalog. */
export const buildSubscriptionsCollection = (args: {
	slug: string
	events: string[]
	hidden: boolean
	secretKeys?: KeysConfig
	urlPolicy: UrlPolicy
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
	access: { read: adminUser, create: adminUser, update: adminUser, delete: adminUser },
	hooks: {
		beforeValidate: [generateOnCreate],
		beforeChange: [normalizeSuppliedSecrets, clearLapsedRotation],
		afterChange: [revealGeneratedSecret],
	},
	fields: [
		// Rows are unnamed, so they lay the form out without touching the schema or stored data.
		{
			type: 'row',
			fields: [
				{ name: 'name', type: 'text', required: true, label: labelForKey(keys.fieldName) },
				{
					name: 'url',
					type: 'text',
					required: true,
					label: labelForKey(keys.fieldUrl),
					validate: makeValidateUrl(args.urlPolicy),
				},
			],
		},
		{
			name: 'enabled',
			type: 'checkbox',
			defaultValue: true,
			label: labelForKey(keys.fieldEnabled),
			admin: { position: 'sidebar' },
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
			name: 'headers',
			type: 'array',
			label: labelForKey(keys.fieldHeaders),
			fields: [
				{
					type: 'row',
					fields: [
						{
							name: 'key',
							type: 'text',
							required: true,
							// Validation judges the trimmed name, so that is the one stored: a padded
							// name would pass the form and then make `fetch` throw at delivery time.
							hooks: { beforeValidate: [trimHeaderName] },
							/**
							 * A custom `validate` replaces Payload's built-in field validation rather
							 * than running alongside it, so `required: true` alone would no longer be
							 * enforced: the empty-value check below is what keeps it.
							 */
							validate: (
								value: string | null | undefined,
								{ previousValue, req }: { previousValue?: unknown; req: PayloadRequest }
							): string | true => {
								if (typeof value !== 'string' || value.trim() === '') {
									// Payload's own key, so this reads the same as every other required field.
									return req.t('validation:required')
								}
								// A name this write is not changing is left alone, for the reason given on
								// the URL validator: a name reserved after the row was saved must not fail
								// every later write to it. The send drops reserved names regardless.
								if (value === previousValue) {
									return true
								}
								if (isReservedHeader(value)) {
									return asTranslate(req.t)(keys.headerReserved, { name: value })
								}
								// A name with a space or a colon saves fine and then makes `fetch` throw
								// at delivery time, so the operator would find out from a dead delivery
								// row rather than from the form.
								return isValidHeaderName(value)
									? true
									: asTranslate(req.t)(keys.headerInvalid, { name: value })
							},
						},
						/**
						 * Encrypted at rest, because this is where a receiver's own credential goes
						 * (`Authorization: Bearer ...`). Masked rather than write-only: plenty of
						 * header values are not secrets and an operator needs to read them back, and
						 * `encryptedField` cannot strip a value inside an array row from responses
						 * anyway. Whoever may read the subscription may still reveal the value.
						 */
						...encryptedField(
							{ name: 'value', type: 'text', validate: validateHeaderValue },
							{
								aadScope: SECRET_AAD_SCOPE,
								keys: args.secretKeys,
								onDecryptFailure: headerDecryptFailure,
							}
						),
					],
				},
			],
		},
		{ name: 'description', type: 'textarea', label: labelForKey(keys.fieldDescription) },
	],
})
