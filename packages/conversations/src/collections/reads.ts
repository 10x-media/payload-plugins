import type { CollectionConfig, Field } from 'payload'

import { ADMIN_GROUP } from '../shared/constants'
import type { ConversationsInstance } from '../types'

const closed = () => false

/** Per-user read cursors: one row per conversation, plus one per opened thread. */
export const buildReadsCollection = (
	instance: ConversationsInstance,
	slug: string
): CollectionConfig => {
	const defaultFields: Field[] = [
		{ name: 'userKey', required: true, type: 'text' },
		{ index: true, name: 'key', required: true, type: 'text' },
		{ defaultValue: '', name: 'thread', type: 'text' },
		{ name: 'lastReadAt', required: true, type: 'date' },
	]
	const override = instance.overrides.reads ?? {}
	return {
		access: {
			create: closed,
			delete: closed,
			read: closed,
			update: closed,
			...override.access,
		},
		admin: { group: ADMIN_GROUP, hidden: true, ...override.admin },
		fields: override.fields ? override.fields({ defaultFields }) : defaultFields,
		hooks: override.hooks,
		indexes: [{ fields: ['userKey', 'key', 'thread'], unique: true }],
		slug,
	}
}
