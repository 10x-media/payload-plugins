import type { CollectionConfig } from 'payload'

/**
 * Tenants for `@payloadcms/plugin-multi-tenant`. Audited too: the plugin treats
 * the tenants collection as its own tenant, so an edit here lands in that tenant's
 * view.
 */
export const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name', group: 'Tenancy' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
	],
}

/**
 * The tenant-scoped collection. The multi-tenant plugin adds its `tenant` field,
 * which the audit log copies onto every entry, so the tenant view at
 * `/admin/audit-logs-tenant` shows only the selected tenant's notes.
 */
export const notes: CollectionConfig = {
	slug: 'notes',
	admin: { useAsTitle: 'title', group: 'Tenancy' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'body', type: 'textarea' },
		{ name: 'pinned', type: 'checkbox' },
	],
}

/**
 * One document per tenant: `isGlobal` in the multi-tenant plugin, so its nav link
 * opens the current tenant's document. The tenant view offers it as a global.
 */
export const tenantSettings: CollectionConfig = {
	slug: 'tenant-settings',
	admin: { useAsTitle: 'siteName', group: 'Tenancy' },
	fields: [
		{ name: 'siteName', type: 'text', required: true },
		{ name: 'supportEmail', type: 'email' },
		{ name: 'maintenance', type: 'checkbox' },
	],
}

/**
 * The tenant-scoped collections, passed as-is to both plugins: the audit log
 * reads `isGlobal` from the same object the multi-tenant plugin does.
 */
export const tenantCollections = {
	notes: {},
	'tenant-settings': { isGlobal: true },
}
