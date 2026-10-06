import type { CollectionConfig, GlobalConfig } from 'payload'

export const users: CollectionConfig = {
	slug: 'users',
	admin: { useAsTitle: 'email' },
	auth: true,
	fields: [],
}

export const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
	],
}

/** A plain collection in the overlay: list, document, create, delete. */
export const tags: CollectionConfig = {
	slug: 'tags',
	admin: { group: 'Content', useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'colour', type: 'select', options: ['red', 'green', 'blue'] },
	],
	// Trash is on here so the panel's delete carries Payload's trash branch, and so its restore
	// and permanent-delete buttons have something to act on.
	trash: true,
}

/** A second grouped collection, so group ordering has something to order. */
export const redirects: CollectionConfig = {
	slug: 'redirects',
	admin: { group: 'Content', useAsTitle: 'from' },
	fields: [
		{ name: 'from', type: 'text', required: true },
		{ name: 'to', type: 'text', required: true },
	],
}

/** Not listed in any overlay, so the nav still has something in it and hiding is visible. */
export const posts: CollectionConfig = {
	slug: 'posts',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'body', type: 'textarea' },
	],
}

/**
 * A collection the multi-tenant plugin treats as a global: one document per tenant. Reached
 * through `tenantGlobalItem`, which resolves the current tenant's document on every open.
 */
export const siteSettings: CollectionConfig = {
	slug: 'site-settings',
	admin: { useAsTitle: 'siteName' },
	fields: [
		{ name: 'siteName', type: 'text', required: true },
		{ name: 'tagline', type: 'text' },
	],
}

/** A real global in the overlay, rendered through the same document pane as a collection doc. */
export const branding: GlobalConfig = {
	slug: 'branding',
	admin: { group: 'Appearance' },
	fields: [
		{ name: 'primaryColour', type: 'text', defaultValue: '#0f62fe' },
		{ name: 'logoText', type: 'text' },
	],
}

/** The one real list behind the fully customized panel, so its header slot has a back button. */
export const apiKeys: CollectionConfig = {
	slug: 'keys',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'scope', type: 'select', options: ['read', 'write', 'admin'] },
	],
}

/** Function-valued `admin.hidden`, so the manifest has a predicate to honour. */
export const secrets: CollectionConfig = {
	slug: 'secrets',
	admin: {
		hidden: ({ user }) => !(user as { email?: string } | null)?.email?.endsWith('@10xmedia.de'),
		useAsTitle: 'name',
	},
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'value', type: 'text' },
	],
}
