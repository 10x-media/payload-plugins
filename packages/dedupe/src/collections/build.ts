import type { Access, CollectionConfig } from 'payload'

import { KEYS_SLUG, MERGE_STATUSES, MERGES_SLUG, PAIR_STATUSES, PAIRS_SLUG } from './slugs'

const never: Access = () => false

/**
 * The plugin's pairs and merges; the keys collection below belongs to the built-in
 * adapter. All are written through the database layer only, so they carry
 * no hooks and no validation of their own; document ids are stored as text because a
 * relationship to a trashed or deleted document renders as nothing, and the whole point
 * of these rows is to still say which documents they were about.
 */
export const buildCollections = (read: Access): CollectionConfig[] => [
	{
		slug: PAIRS_SLUG,
		admin: { hidden: true, useAsTitle: 'pairKey' },
		access: { create: never, delete: never, read, update: never },
		disableDuplicate: true,
		indexes: [
			{ fields: ['target', 'status', 'score'] },
			{ fields: ['target', 'tenant', 'status'] },
			{ fields: ['target', 'docA'] },
			{ fields: ['target', 'docB'] },
		],
		fields: [
			{ name: 'target', type: 'text', required: true, index: true },
			{ name: 'pairKey', type: 'text', required: true, unique: true, index: true },
			{ name: 'docA', type: 'text', required: true, index: true },
			{ name: 'docB', type: 'text', required: true, index: true },
			{ name: 'tenant', type: 'text', index: true },
			{ name: 'score', type: 'number', required: true, index: true },
			{ name: 'signals', type: 'json' },
			{
				name: 'status',
				type: 'select',
				required: true,
				defaultValue: 'open',
				index: true,
				options: PAIR_STATUSES.map((value) => ({ label: value, value })),
			},
			{ name: 'lastSeenAt', type: 'date', index: true },
			{ name: 'decidedAt', type: 'date' },
			{ name: 'decidedBy', type: 'text' },
			{ name: 'merge', type: 'text', index: true },
		],
	},
	{
		slug: MERGES_SLUG,
		admin: { hidden: true },
		access: { create: never, delete: never, read, update: never },
		disableDuplicate: true,
		indexes: [{ fields: ['target', 'tenant'] }],
		fields: [
			{ name: 'target', type: 'text', required: true, index: true },
			{ name: 'survivor', type: 'text', required: true },
			{ name: 'absorbed', type: 'text', hasMany: true, required: true },
			{ name: 'tenant', type: 'text', index: true },
			{
				name: 'status',
				type: 'select',
				required: true,
				defaultValue: 'applying',
				options: MERGE_STATUSES.map((value) => ({ label: value, value })),
			},
			{ name: 'decisions', type: 'json' },
			{ name: 'absorbedSnapshots', type: 'json' },
			{ name: 'repointed', type: 'json' },
			{ name: 'released', type: 'json' },
			{ name: 'appliedBy', type: 'text' },
			{ name: 'error', type: 'textarea' },
		],
	},
]

/** The built-in adapter's rows: one per document and blocking key. */
export const buildKeysCollection = (read: Access): CollectionConfig => ({
	slug: KEYS_SLUG,
	admin: { hidden: true },
	access: { create: never, delete: never, read, update: never },
	disableDuplicate: true,
	timestamps: false,
	indexes: [{ fields: ['target', 'key'] }, { fields: ['target', 'doc'] }],
	fields: [
		{ name: 'target', type: 'text', required: true, index: true },
		{ name: 'doc', type: 'text', required: true, index: true },
		{ name: 'key', type: 'text', required: true, index: true },
		{ name: 'configHash', type: 'text', required: true, index: true },
	],
})
