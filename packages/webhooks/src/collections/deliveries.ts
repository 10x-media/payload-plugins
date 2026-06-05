import type { CollectionConfig } from 'payload'

import { ADMIN_GROUP } from '../constants'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

const STATUS_CELL = '@10x-media/webhooks/client#DeliveryStatusCell'

const loggedIn = ({ req }: { req: { user?: unknown } }) => Boolean(req.user)

/** Runner-written delivery audit log; read-only in admin, server writes use overrideAccess. */
export const buildDeliveriesCollection = (args: {
	slug: string
	hidden: boolean
}): CollectionConfig => ({
	slug: args.slug,
	labels: {
		singular: labelForKey(keys.deliverySingular),
		plural: labelForKey(keys.deliveryPlural),
	},
	admin: {
		group: ADMIN_GROUP,
		useAsTitle: 'event',
		defaultColumns: ['event', 'endpoint', 'status', 'responseStatus', 'attempt', 'createdAt'],
		hidden: args.hidden,
	},
	access: { read: loggedIn, create: () => false, update: () => false, delete: loggedIn },
	fields: [
		{ name: 'subscriptionId', type: 'text', index: true },
		{ name: 'endpoint', type: 'text' },
		{ name: 'event', type: 'text', index: true },
		{
			name: 'status',
			type: 'select',
			defaultValue: 'pending',
			options: ['pending', 'success', 'failed', 'dead'],
			admin: { components: { Cell: STATUS_CELL } },
		},
		{ name: 'attempt', type: 'number', defaultValue: 0 },
		{ name: 'responseStatus', type: 'number' },
		{ name: 'responseBody', type: 'textarea' },
		{ name: 'error', type: 'textarea' },
		{ name: 'durationMs', type: 'number' },
		{ name: 'jobId', type: 'text' },
		{ name: 'payload', type: 'json' },
	],
})
