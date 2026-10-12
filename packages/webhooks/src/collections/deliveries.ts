import type { CollectionConfig } from 'payload'

import { ADMIN_GROUP } from '../constants'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { adminUser } from './access'

const STATUS_CELL = '@10x-media/webhooks/client#DeliveryStatusCell'

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
	access: { read: adminUser, create: () => false, update: () => false, delete: adminUser },
	fields: [
		{ name: 'subscriptionId', type: 'text', index: true },
		/**
		 * Which registry `subscriptionId` belongs to, `collection` or `code`. A code subscription's
		 * id is whatever its author wrote and a collection row's is whatever the database issued, so
		 * the two can coincide; without this a queued or replayed delivery could be resolved against
		 * the wrong one. Rows written before the field existed carry none and resolve code first, as
		 * they always did.
		 */
		{ name: 'subscriptionSource', type: 'text' },
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
