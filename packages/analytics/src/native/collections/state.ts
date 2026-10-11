import type { CollectionConfig } from 'payload'
import { STATE_SLUG } from './slugs'
import { storeCollection } from './storeCollection'

/**
 * Coordination rows under readable keys (`salt:2026-10-05`, `day:<scope>:20261005`,
 * `lease:maintain`, `heartbeat:analytics-maintain`); Payload's KV store has no compare-and-set.
 */
export const stateCollection = (slug: string = STATE_SLUG): CollectionConfig =>
	storeCollection({
		slug,
		fields: [
			{ name: 'kind', type: 'text', required: true },
			{ name: 'scope', type: 'text', required: true, defaultValue: '' },
			{ name: 'day', type: 'number' },
			{ name: 'tz', type: 'text' },
			{ name: 'status', type: 'text' },
			{ name: 'version', type: 'number' },
			{ name: 'gen', type: 'text' },
			{ name: 'hits', type: 'number' },
			{ name: 'leaseOwner', type: 'text' },
			{ name: 'leaseUntil', type: 'date' },
			{ name: 'finalAfter', type: 'date' },
			{ name: 'aggregatedAt', type: 'date' },
			{ name: 'value', type: 'json' },
			{ name: 'expiresAt', type: 'date' },
		],
		indexes: [{ fields: ['kind', 'status', 'day'] }, { fields: ['kind', 'scope', 'day'] }],
	})
