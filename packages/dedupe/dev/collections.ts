import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionConfig, GlobalConfig } from 'payload'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** One definition for the dev app and the integration tests, so the two never drift. */

export const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	admin: { useAsTitle: 'email' },
	fields: [],
}

/** The offices of the dev stand; `@payloadcms/plugin-multi-tenant` scopes the rest by them. */
export const tenants: CollectionConfig = {
	slug: 'tenants',
	admin: { useAsTitle: 'name' },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'slug', type: 'text', required: true, unique: true },
	],
}

/** Closed to readers whose email starts with `limited`, like `leads`, for the access tests. */
export const companies: CollectionConfig = {
	slug: 'companies',
	admin: { useAsTitle: 'name' },
	access: {
		read: ({ req }) =>
			!String((req.user as { email?: string } | null)?.email ?? '').startsWith('limited'),
	},
	fields: [{ name: 'name', type: 'text' }],
}

/** A people-like collection with the field shapes the merge has to handle. */
export const customers: CollectionConfig = {
	slug: 'customers',
	trash: true,
	admin: {
		useAsTitle: 'name',
		defaultColumns: ['name', 'tenant', 'email', 'phone', 'birthDate'],
		// Dev stand only: open the create form with a look-alike typed in.
		components: {
			beforeListTable: ['/components/NearDuplicate#NearDuplicateListButton'],
			edit: { beforeDocumentControls: ['/components/NearDuplicate#NearDuplicateButton'] },
		},
	},
	fields: [
		{
			name: 'devPrefill',
			type: 'ui',
			admin: {
				disableListColumn: true,
				components: { Field: '/components/NearDuplicate#DevPrefill' },
			},
		},
		{ name: 'name', type: 'text', localized: true },
		{ name: 'email', type: 'email', unique: true },
		{ name: 'customerNumber', type: 'number', unique: true },
		{ name: 'phone', type: 'text' },
		{ name: 'birthDate', type: 'date' },
		{ name: 'tags', type: 'text', hasMany: true },
		{ name: 'vip', type: 'checkbox' },
		{
			name: 'tier',
			type: 'select',
			options: [
				{ label: 'Gold tier', value: 'gold' },
				{ label: 'Silver tier', value: 'silver' },
			],
		},
		{ name: 'company', type: 'relationship', relationTo: 'companies' },
		// A customer pointing at another one, for a merge to drop a pointer at its own group.
		{ name: 'referredBy', type: 'relationship', relationTo: 'customers' },
		{ name: 'internalNote', type: 'text', admin: { hidden: true } },
		// Readers whose email starts with `limited` may not read it, for the field access tests.
		{
			name: 'creditLimit',
			type: 'number',
			access: {
				read: ({ req }) =>
					!String((req.user as { email?: string } | null)?.email ?? '').startsWith('limited'),
			},
		},
		// The host's own sidebar, for the plugin's panel to sit beside.
		{
			name: 'status',
			type: 'select',
			defaultValue: 'active',
			options: ['lead', 'active', 'churned'],
			admin: { position: 'sidebar' },
		},
		{
			name: 'accountManager',
			type: 'relationship',
			relationTo: 'users',
			admin: { position: 'sidebar' },
		},
		{ name: 'lastContactedAt', type: 'date', admin: { position: 'sidebar' } },
		{
			name: 'addresses',
			type: 'array',
			fields: [
				{ name: 'city', type: 'text' },
				{ name: 'street', type: 'text' },
			],
		},
		{
			name: 'profile',
			type: 'group',
			fields: [
				{ name: 'bio', type: 'textarea', localized: true },
				{ name: 'score', type: 'number' },
			],
		},
		{
			type: 'tabs',
			tabs: [
				{ label: 'Meta', fields: [{ name: 'note', type: 'text' }] },
				{ name: 'extra', label: 'Extra', fields: [{ name: 'code', type: 'text' }] },
			],
		},
	],
}

/**
 * No trash and no match config: the manual merge with hard delete. Readers whose email
 * starts with `limited` may not read it, so the tests have a document to be refused on.
 */
export const leads: CollectionConfig = {
	slug: 'leads',
	admin: { useAsTitle: 'email' },
	access: {
		read: ({ req }) =>
			!String((req.user as { email?: string } | null)?.email ?? '').startsWith('limited'),
	},
	fields: [
		{ name: 'email', type: 'email' },
		{ name: 'source', type: 'text' },
	],
}

/** Drafts on: the merge of the published state has to notice a draft newer than it. */
export const articles: CollectionConfig = {
	slug: 'articles',
	trash: true,
	versions: { drafts: true },
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text' },
		{ name: 'summary', type: 'textarea' },
		// A localized field gives Publish its "Publish in <locale>" option.
		{ name: 'tagline', type: 'text', localized: true },
	],
}

/** Numbers matched three ways: the same SKU, a barcode off by a digit, a price within 5%. */
export const products: CollectionConfig = {
	slug: 'products',
	trash: true,
	admin: { useAsTitle: 'name', defaultColumns: ['name', 'sku', 'barcode', 'price'] },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'sku', type: 'number' },
		{ name: 'barcode', type: 'number' },
		{ name: 'price', type: 'number' },
	],
}

/**
 * Documents pointing at customers, one of each shape a reference can take, for the repoint
 * that moves them to the surviving customer on a merge.
 */
export const orders: CollectionConfig = {
	slug: 'orders',
	admin: { useAsTitle: 'number', defaultColumns: ['number', 'customer', 'tenant'] },
	fields: [
		{ name: 'number', type: 'text', required: true },
		{ name: 'customer', type: 'relationship', relationTo: 'customers' },
		{
			name: 'items',
			type: 'array',
			fields: [
				{ name: 'product', type: 'text' },
				{ name: 'handledBy', type: 'relationship', relationTo: 'customers' },
			],
		},
		{ name: 'reviewedBy', type: 'relationship', relationTo: 'customers', localized: true },
	],
}

/** One membership per customer and club: a merge can make two collide. */
export const memberships: CollectionConfig = {
	slug: 'memberships',
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'customer', 'club'] },
	indexes: [{ fields: ['customer', 'club'], unique: true }],
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'customer', type: 'relationship', relationTo: 'customers', required: true },
		{ name: 'club', type: 'relationship', relationTo: 'companies', required: true },
	],
}

export const trips: CollectionConfig = {
	slug: 'trips',
	admin: { useAsTitle: 'title' },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'participants', type: 'relationship', relationTo: 'customers', hasMany: true },
	],
}

/** A polymorphic reference, and drafts: a note with unpublished changes blocks a merge. */
export const notes: CollectionConfig = {
	slug: 'notes',
	admin: { useAsTitle: 'text' },
	versions: { drafts: true },
	fields: [
		{ name: 'text', type: 'text', required: true },
		{ name: 'about', type: 'relationship', relationTo: ['customers', 'companies'] },
	],
}

/** Images for the specimens' upload fields. */
export const media: CollectionConfig = {
	slug: 'media',
	upload: { staticDir: path.resolve(dirname, 'uploads') },
	fields: [{ name: 'alt', type: 'text' }],
}

/** Every kind of field Payload has, so the merge screen shows each one. */
export const specimens: CollectionConfig = {
	slug: 'specimens',
	trash: true,
	admin: { useAsTitle: 'title', defaultColumns: ['title', 'email', 'level', 'updatedAt'] },
	fields: [
		{ name: 'title', type: 'text', required: true },
		{ name: 'email', type: 'email', unique: true },
		{ name: 'bio', type: 'textarea' },
		{ name: 'age', type: 'number' },
		{ name: 'birthDate', type: 'date' },
		{ name: 'level', type: 'select', options: ['junior', 'middle', 'senior'] },
		{ name: 'skills', type: 'select', hasMany: true, options: ['ts', 'go', 'sql', 'css'] },
		{ name: 'contactBy', type: 'radio', options: ['email', 'phone', 'post'] },
		{ name: 'active', type: 'checkbox' },
		{ name: 'company', type: 'relationship', relationTo: 'companies' },
		{ name: 'friends', type: 'relationship', relationTo: 'customers', hasMany: true },
		{ name: 'about', type: 'relationship', relationTo: ['companies', 'customers'] },
		{ name: 'avatar', type: 'upload', relationTo: 'media' },
		{ name: 'notes', type: 'richText' },
		{ name: 'settings', type: 'json' },
		{ name: 'location', type: 'point' },
		{ name: 'snippet', type: 'code', admin: { language: 'ts' } },
		{ name: 'aliases', type: 'text', hasMany: true },
		{ name: 'scores', type: 'number', hasMany: true },
		{
			name: 'links',
			type: 'array',
			fields: [
				{ name: 'label', type: 'text' },
				{ name: 'url', type: 'text' },
				// A value per locale inside rows that are not localized themselves.
				{ name: 'caption', type: 'text', localized: true },
			],
		},
		// Rows that hold a relationship and rows of their own: an array in an array.
		{
			name: 'publications',
			type: 'array',
			fields: [
				{ name: 'title', type: 'text' },
				{ name: 'publisher', type: 'relationship', relationTo: 'companies' },
				{ name: 'year', type: 'number' },
				{
					name: 'editions',
					type: 'array',
					fields: [
						{ name: 'format', type: 'select', options: ['print', 'ebook', 'audio'] },
						{ name: 'isbn', type: 'text' },
					],
				},
			],
		},
		{
			name: 'layout',
			type: 'blocks',
			blocks: [
				{
					slug: 'hero',
					fields: [
						{ name: 'heading', type: 'text' },
						{ name: 'image', type: 'upload', relationTo: 'media' },
					],
				},
				{
					slug: 'quote',
					fields: [
						{ name: 'text', type: 'textarea' },
						{ name: 'author', type: 'text' },
					],
				},
				// Blocks in a block, one of them pointing at a document.
				{
					slug: 'section',
					fields: [
						{ name: 'heading', type: 'text' },
						{
							name: 'content',
							type: 'blocks',
							blocks: [
								{ slug: 'paragraph', fields: [{ name: 'text', type: 'textarea' }] },
								{
									slug: 'cta',
									fields: [
										{ name: 'label', type: 'text' },
										{ name: 'contact', type: 'relationship', relationTo: 'customers' },
									],
								},
							],
						},
					],
				},
			],
		},
		{
			name: 'address',
			type: 'group',
			fields: [
				{ name: 'city', type: 'text' },
				{ name: 'street', type: 'text' },
			],
		},
		{
			type: 'tabs',
			tabs: [{ name: 'social', label: 'Social', fields: [{ name: 'twitter', type: 'text' }] }],
		},
		{ name: 'motto', type: 'text', localized: true },
		{ name: 'summary', type: 'textarea', localized: true },
		{ name: 'secret', type: 'text', admin: { hidden: true } },
	],
}

/**
 * A `tenant` field the multi-tenant plugin does not scope: here the branch a member answers
 * for. Left out of `multiTenancy.collections`, it is ordinary data to dedupe.
 */
export const staff: CollectionConfig = {
	slug: 'staff',
	labels: { singular: 'Staff member', plural: 'Staff' },
	admin: { useAsTitle: 'name', defaultColumns: ['name', 'email', 'tenant'] },
	fields: [
		{ name: 'name', type: 'text', required: true },
		{ name: 'email', type: 'email' },
		{ name: 'tenant', type: 'text', label: 'Branch' },
	],
}

export const collections = [
	users,
	tenants,
	companies,
	customers,
	leads,
	articles,
	orders,
	memberships,
	trips,
	notes,
	media,
	specimens,
	products,
	staff,
]

/** A global that points at a customer, so a merge moves a reference held outside any collection. */
export const site: GlobalConfig = {
	slug: 'site',
	fields: [{ name: 'featuredCustomer', type: 'relationship', relationTo: 'customers' }],
}

export const globals = [site]
