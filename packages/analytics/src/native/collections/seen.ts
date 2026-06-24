import type { CollectionConfig } from 'payload'

export const SEEN_SLUG = 'analytics-seen'

// Dedup ledger for exact distinct counting. One row per (rollup bucket, kind, value);
// the unique index is the entire correctness mechanism. Every key field is required so
// Postgres emits NOT NULL columns (a nullable column would make NULLs distinct and break
// dedup). Written only through the raw insertIfNew primitive; never read by the admin.
export const seenCollection = (): CollectionConfig => ({
	slug: SEEN_SLUG,
	admin: { hidden: true },
	access: { read: () => false, create: () => true, update: () => false, delete: () => true },
	fields: [
		{ name: 'bucket', type: 'text', required: true },
		{ name: 'kind', type: 'text', required: true },
		{ name: 'value', type: 'text', required: true },
		{ name: 'period', type: 'date', required: true, index: true },
	],
	indexes: [{ fields: ['bucket', 'kind', 'value'], unique: true }],
})
