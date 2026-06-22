import { randomBytes } from 'node:crypto'
import type {
	CollectionAfterChangeHook,
	CollectionBeforeChangeHook,
	CollectionConfig,
	FieldHook,
} from 'payload'

import { ADMIN_GROUP, SECRET_MASK, SECRET_REVEAL_CONTEXT } from '../constants'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const generateSecret: CollectionBeforeChangeHook = ({ data, operation, req }) => {
	if (operation === 'create' && !data.secret) {
		req.context[SECRET_REVEAL_CONTEXT.once] = true
		return { ...data, secret: randomBytes(24).toString('hex') }
	}
	return data
}

/**
 * The DB always stores the raw secret; this mask only shapes read output. It runs even under
 * `overrideAccess` (field hooks are not gated by access), so the raw value reaches a reader only
 * when a reveal flag is set: `once` on the create response, `forSigning` on internal delivery reads.
 */
const maskSecret: FieldHook = ({ value, req }) => {
	if (req.context[SECRET_REVEAL_CONTEXT.forSigning] || req.context[SECRET_REVEAL_CONTEXT.once]) {
		return value
	}
	return value == null ? value : SECRET_MASK
}

const clearRevealOnce: CollectionAfterChangeHook = ({ doc, req }) => {
	req.context[SECRET_REVEAL_CONTEXT.once] = false
	return doc
}

const rejectNoneEvent: CollectionBeforeChangeHook = ({ data }) => {
	const events = data?.events as unknown[] | undefined
	if (Array.isArray(events) && events.includes('__none__')) {
		throw new Error(
			'@10x-media/webhooks: cannot save a subscription with no valid events; add at least one event to the catalog first.'
		)
	}
	return data
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
	hooks: { beforeChange: [generateSecret, rejectNoneEvent], afterChange: [clearRevealOnce] },
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
			name: 'headers',
			type: 'array',
			label: labelForKey(keys.fieldHeaders),
			fields: [
				{ name: 'key', type: 'text', required: true },
				{ name: 'value', type: 'text' },
			],
		},
		{ name: 'description', type: 'textarea', label: labelForKey(keys.fieldDescription) },
	],
})
